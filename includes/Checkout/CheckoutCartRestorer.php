<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

final class CheckoutCartRestorer {
	private const CORE_CART_ITEM_KEYS = array(
		'key', 'product_id', 'variation_id', 'variation', 'quantity', 'data', 'data_hash',
		'line_tax_data', 'line_subtotal', 'line_subtotal_tax', 'line_total', 'line_tax',
	);

	public function __construct( private readonly CheckoutCapture $capture ) {}

	/** Rebuild a snapshot, apply original coupons and commit fresh activity before success. */
	public function restore( array $snapshot, callable $after_apply ): array|false {
		try {
			$plan = $this->preflight( $snapshot );
			$commerce = function_exists( 'WC' ) ? WC() : null;
			$cart = is_object( $commerce ) ? ( $commerce->cart ?? null ) : null;
		} catch ( \Throwable $error ) {
			self::log( 'restore_preflight_failed', $error );
			return false;
		}
		if ( null === $plan || ! is_object( $cart ) || ! method_exists( $cart, 'get_cart' ) ||
			! method_exists( $cart, 'empty_cart' ) || ! method_exists( $cart, 'add_to_cart' ) ||
			! method_exists( $cart, 'calculate_totals' ) || ! method_exists( $cart, 'get_applied_coupons' ) ||
			! method_exists( $cart, 'apply_coupon' ) ) {
			self::log( 'restore_preflight_rejected' );
			return false;
		}
		$backup_lines = $cart->get_cart();
		$backup_coupons = $cart->get_applied_coupons();
		if ( ! is_array( $backup_lines ) || ! is_array( $backup_coupons ) || ! array_is_list( $backup_coupons ) ) {
			self::log( 'restore_backup_unavailable' );
			return false;
		}
		foreach ( $backup_coupons as $code ) {
			if ( ! is_string( $code ) || '' === $code ) {
				self::log( 'restore_backup_unavailable' );
				return false;
			}
		}
		$backup = array( 'lines' => $backup_lines, 'coupons' => $backup_coupons );

		try {
			$this->capture->withoutCapture( function () use ( $cart, $plan ): void {
				$cart->empty_cart();
				foreach ( $plan as $line ) {
					$result = $cart->add_to_cart( $line['productId'], $line['quantity'], $line['variationId'], $line['attributes'] );
					if ( false === $result ) throw new \RuntimeException( 'restore_add_to_cart_rejected' );
				}
			} );
			$coupon_result = $this->capture->withoutCapture( function () use ( $cart, $snapshot ): array {
				return ( new CheckoutCouponRestorer() )->restore( $cart, $snapshot['appliedCouponCodes'] );
			} );
			if ( ! $after_apply() ) throw new \RuntimeException( 'restore_commit_rejected' );
			return $coupon_result;
		} catch ( \Throwable $error ) {
			self::log( 'restore_apply_failed', self::redactCouponValues( $error, $snapshot['appliedCouponCodes'] ?? array() ) );
			try {
				$this->capture->withoutCapture( function () use ( $cart, $backup ): void {
					$cart->empty_cart();
					foreach ( $backup['lines'] as $line ) {
						if ( ! is_array( $line ) || ! isset( $line['product_id'], $line['quantity'] ) ||
							! is_numeric( $line['product_id'] ) || ! is_numeric( $line['quantity'] ) ) {
							throw new \RuntimeException( 'restore_rollback_item_invalid' );
						}
						$item_data = array_diff_key( $line, array_flip( self::CORE_CART_ITEM_KEYS ) );
						$result = $cart->add_to_cart(
							(int) $line['product_id'], (int) $line['quantity'], (int) ( $line['variation_id'] ?? 0 ),
							is_array( $line['variation'] ?? null ) ? $line['variation'] : array(), $item_data
						);
						if ( false === $result ) throw new \RuntimeException( 'restore_rollback_add_rejected' );
					}
					foreach ( $backup['coupons'] as $code ) {
						$notices = function_exists( 'wc_get_notices' ) ? wc_get_notices() : null;
						try {
							if ( ! $cart->apply_coupon( $code ) ) throw new \RuntimeException( 'restore_rollback_coupon_rejected' );
						} finally {
							if ( is_array( $notices ) && function_exists( 'wc_set_notices' ) ) wc_set_notices( $notices );
						}
					}
					$cart->calculate_totals();
				} );
			} catch ( \Throwable $rollback_error ) {
				self::log( 'restore_rollback_failed', self::redactCouponValues( $rollback_error, $backup['coupons'] ) );
			}
			return false;
		}
	}

	private function preflight( array $snapshot ): ?array {
		$keys = array_keys( $snapshot );
		sort( $keys );
		if ( $keys !== array( 'appliedCouponCodes', 'kind', 'lines', 'schemaVersion' ) ||
			'woo.cart-restore.v1' !== ( $snapshot['schemaVersion'] ?? null ) || 'supported' !== ( $snapshot['kind'] ?? null ) ||
			! is_array( $snapshot['appliedCouponCodes'] ?? null ) || ! array_is_list( $snapshot['appliedCouponCodes'] ) ||
			count( $snapshot['appliedCouponCodes'] ) > 10 || ! is_array( $snapshot['lines'] ?? null ) ||
			array_is_list( $snapshot['lines'] ) === false || count( $snapshot['lines'] ) < 1 || count( $snapshot['lines'] ) > 50 ||
			! function_exists( 'wc_get_product' ) ) return null;
		foreach ( $snapshot['appliedCouponCodes'] as $code ) {
			if ( ! self::boundedText( $code, 128 ) ) return null;
		}

		$plan = array();
		foreach ( $snapshot['lines'] as $line ) {
			if ( ! is_array( $line ) ) return null;
			$keys = array_keys( $line );
			if ( ! in_array( 'productId', $keys, true ) || ! in_array( 'quantity', $keys, true ) ||
				array_diff( $keys, array( 'productId', 'variationId', 'quantity', 'attributes' ) ) ||
				! self::positiveId( $line['productId'] ) || ! is_int( $line['quantity'] ) ||
				$line['quantity'] < 1 || $line['quantity'] > 100000 ) return null;
			$product_id = filter_var( $line['productId'], FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => 1 ) ) );
			if ( false === $product_id ) return null;
			$quantity = $line['quantity'];
			$attributes = $line['attributes'] ?? array();
			if ( ! is_array( $attributes ) || count( $attributes ) > 10 ) return null;
			foreach ( $attributes as $key => $value ) {
				if ( ! is_string( $key ) || ! preg_match( '/^attribute_[a-z0-9_-]{1,71}$/D', $key ) ||
					! self::boundedText( $value, 200 ) ) return null;
			}

			if ( ! array_key_exists( 'variationId', $line ) ) {
				if ( array_key_exists( 'attributes', $line ) || ! class_exists( '\\WC_Product_Simple' ) ) return null;
				$product = wc_get_product( $product_id );
				if ( ! $product instanceof \WC_Product_Simple || (int) $product->get_id() !== $product_id ||
					'simple' !== $product->get_type() || ! self::purchasable( $product, $quantity ) ) return null;
				$plan[] = array( 'productId' => $product_id, 'quantity' => $quantity, 'variationId' => 0, 'attributes' => array() );
				continue;
			}

			if ( ! self::positiveId( $line['variationId'] ) || ! class_exists( '\\WC_Product_Variation' ) ||
				! class_exists( '\\WC_Product_Variable' ) ) return null;
			$variation_id = filter_var( $line['variationId'], FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => 1 ) ) );
			if ( false === $variation_id ) return null;
			$parent = wc_get_product( $product_id );
			$variation = wc_get_product( $variation_id );
			if ( ! $parent instanceof \WC_Product_Variable || 'variable' !== $parent->get_type() ||
				! $variation instanceof \WC_Product_Variation || 'variation' !== $variation->get_type() ||
				(int) $variation->get_parent_id() !== $product_id || (int) $variation->get_id() !== $variation_id ||
				! self::purchasable( $variation, $quantity ) || ! method_exists( $variation, 'get_variation_attributes' ) ) return null;
			$expected = array();
			foreach ( $variation->get_variation_attributes() as $attribute => $value ) {
				$key = str_starts_with( (string) $attribute, 'attribute_' ) ? (string) $attribute : 'attribute_' . $attribute;
				$expected[ $key ] = (string) $value;
			}
			ksort( $expected );
			$actual = $attributes;
			ksort( $actual );
			if ( $actual !== $expected ) return null;
			$plan[] = array( 'productId' => $product_id, 'quantity' => $quantity, 'variationId' => $variation_id, 'attributes' => $actual );
		}
		return $plan;
	}

	private static function purchasable( mixed $product, int $quantity ): bool {
		return is_object( $product ) && method_exists( $product, 'is_purchasable' ) && $product->is_purchasable() &&
			method_exists( $product, 'is_in_stock' ) && $product->is_in_stock() &&
			method_exists( $product, 'has_enough_stock' ) && $product->has_enough_stock( $quantity ) &&
			method_exists( $product, 'is_sold_individually' ) && ( ! $product->is_sold_individually() || 1 === $quantity );
	}

	private static function positiveId( mixed $value ): bool {
		return is_string( $value ) && strlen( $value ) <= 20 && 1 === preg_match( '/^[1-9][0-9]*$/D', $value );
	}

	private static function boundedText( mixed $value, int $maximum ): bool {
		return is_string( $value ) && '' !== $value && false !== preg_match_all( '/./us', $value, $matches ) &&
			count( $matches[0] ) <= $maximum && 1 !== preg_match( '/\p{Cc}/u', $value );
	}

	private static function log( string $reason, ?\Throwable $error = null ): void {
		CheckoutDiagnosticLogger::record( 'checkout_restore', $reason, $error );
	}

	private static function redactCouponValues( \Throwable $error, mixed $coupon_codes ): \Throwable {
		$message = $error->getMessage();
		if ( is_array( $coupon_codes ) ) {
			foreach ( $coupon_codes as $code ) {
				if ( is_string( $code ) && '' !== $code ) $message = str_ireplace( $code, '[redacted-coupon]', $message );
			}
		}
		return new \RuntimeException( CheckoutDiagnosticLogger::redact( $message ) );
	}
}
