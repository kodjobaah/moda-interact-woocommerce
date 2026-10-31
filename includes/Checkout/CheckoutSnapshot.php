<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Strict woo.activity.v1 checkout projection; no consent or guessed customer identity. */
final class CheckoutSnapshot {
	private const RESTORE_VERSION = 'woo.cart-restore.v1';
	private const MAX_RESTORATION_BYTES = 16384;
	private const CORE_CART_ITEM_KEYS = array(
		'key', 'product_id', 'variation_id', 'variation', 'quantity', 'data', 'data_hash',
		'line_tax_data', 'line_subtotal', 'line_subtotal_tax', 'line_total', 'line_tax',
	);

	public static function fromCart( mixed $cart, mixed $customer ): ?array {
		if ( ! is_object( $cart ) || ! method_exists( $cart, 'get_cart' ) || ! method_exists( $cart, 'get_total' ) ) {
			self::log( 'cart_unavailable' );
			return null;
		}
		$currency = function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : null;
		if ( ! is_string( $currency ) || ! preg_match( '/^[A-Z]{3}$/D', $currency ) ) {
			self::log( 'currency_unavailable' );
			return null;
		}
		$lines = $cart->get_cart();
		if ( ! is_array( $lines ) ) {
			self::log( 'items_unavailable' );
			return null;
		}
		$restoration = self::restoration( $cart, $lines );
		// A verified empty cart is different from unavailable/oversized item data.
		// Woo may still hold its pre-removal total until calculate_totals() runs;
		// calculate_totals() itself skips the after-totals hook for an empty cart.
		if ( array() === $lines ) return array( 'currency' => $currency, 'total' => '0.00', 'items' => array(), 'restoration' => $restoration );
		$total = self::money( $cart->get_total( 'edit' ) );
		if ( null === $total ) {
			self::log( 'total_unavailable' );
			return null;
		}
		$snapshot = array( 'currency' => $currency, 'total' => $total, 'restoration' => $restoration );
		// Never publish a misleading *partial* basket if a shop has more than 50 lines.
		if ( count( $lines ) <= 50 ) {
			$items = array();
			foreach ( $lines as $line ) {
				if ( ! is_array( $line ) || ! isset( $line['quantity'] ) || ! is_numeric( $line['quantity'] ) ) {
					self::log( 'display_quantity_invalid' );
					return null;
				}
				$qty = (int) $line['quantity'];
				if ( $qty < 1 || $qty > 100000 || (float) $line['quantity'] !== (float) $qty ) {
					self::log( 'display_quantity_invalid' );
					return null;
				}
				$item = array( 'quantity' => $qty );
				foreach ( array( 'product_id' => 'productId', 'variation_id' => 'variationId' ) as $source => $target ) {
					if ( ! empty( $line[ $source ] ) && ctype_digit( (string) $line[ $source ] ) ) {
						$item[ $target ] = substr( (string) $line[ $source ], 0, 128 );
					}
				}
				$product = $line['data'] ?? null;
				if ( is_object( $product ) ) {
					if ( method_exists( $product, 'get_sku' ) ) self::putBounded( $item, 'sku', $product->get_sku(), 128 );
					if ( method_exists( $product, 'get_name' ) ) self::putBounded( $item, 'title', $product->get_name(), 200 );
				}
				if ( isset( $line['line_total'] ) ) {
					$line_total = self::money( $line['line_total'] );
					if ( null !== $line_total ) $item['total'] = $line_total;
				}
				if ( isset( $line['line_total'] ) ) {
					$unit_price = self::money( (float) $line['line_total'] / $qty );
					if ( null !== $unit_price ) $item['unitPrice'] = $unit_price;
				}
				$items[] = $item;
			}
			$snapshot['items'] = $items;
		}
		if ( is_object( $customer ) ) {
			$contact = array();
			foreach ( array( 'get_billing_first_name' => 'firstName', 'get_billing_last_name' => 'lastName' ) as $method => $target ) {
				if ( method_exists( $customer, $method ) ) self::putBounded( $contact, $target, $customer->$method(), 100 );
			}
			if ( method_exists( $customer, 'get_billing_email' ) ) {
				$email = $customer->get_billing_email();
				if ( is_string( $email ) && strlen( $email ) <= 254 && filter_var( $email, FILTER_VALIDATE_EMAIL ) ) $contact['email'] = $email;
			}
			if ( method_exists( $customer, 'get_billing_phone' ) ) {
				$phone = $customer->get_billing_phone();
				if ( is_string( $phone ) && preg_match( '/^\+?[0-9 ()-]{5,32}$/D', $phone ) ) $contact['phone'] = $phone;
			}
			if ( $contact ) $snapshot['contact'] = $contact;
		}
		return $snapshot;
	}

	/** Complete restore projection; unsupported evidence never contains partial lines/coupons. */
	private static function restoration( object $cart, array $lines ): array {
		$coupon_result = self::appliedCoupons( $cart );
		if ( ! isset( $coupon_result['codes'] ) ) return self::unsupported( $coupon_result['reason'] );
		$coupons = $coupon_result['codes'];
		if ( count( $lines ) < 1 ) return self::unsupported( 'ITEMS_UNAVAILABLE', $coupons );
		if ( count( $lines ) > 50 ) return self::unsupported( 'LIMIT_EXCEEDED', $coupons );

		$restore_lines = array();
		foreach ( $lines as $line ) {
			if ( ! is_array( $line ) ) return self::unsupported( 'ITEMS_UNAVAILABLE', $coupons );
			foreach ( array_keys( $line ) as $key ) {
				if ( ! is_string( $key ) || ! in_array( $key, self::CORE_CART_ITEM_KEYS, true ) ) {
					return self::unsupported( 'CUSTOM_CART_ITEM_DATA', $coupons );
				}
			}

			$product_id = self::positiveId( $line['product_id'] ?? null );
			if ( null === $product_id ) return self::unsupported( 'ITEMS_UNAVAILABLE', $coupons );
			$quantity = $line['quantity'] ?? null;
			if ( ! is_int( $quantity ) && ! ( is_string( $quantity ) && ctype_digit( $quantity ) ) ) {
				return self::unsupported( 'LIMIT_EXCEEDED', $coupons );
			}
			$quantity = (int) $quantity;
			if ( $quantity < 1 || $quantity > 100000 ) return self::unsupported( 'LIMIT_EXCEEDED', $coupons );

			$product = $line['data'] ?? null;
			if ( ! is_object( $product ) || ! method_exists( $product, 'get_type' ) || ! method_exists( $product, 'get_id' ) ) {
				return self::unsupported( 'ITEMS_UNAVAILABLE', $coupons );
			}
			try {
				$type = $product->get_type();
				$loaded_id = self::positiveId( $product->get_id() );
			} catch ( \Throwable $error ) {
				self::log( 'product_unavailable' );
				return self::unsupported( 'ITEMS_UNAVAILABLE', $coupons );
			}
			if ( ! in_array( $type, array( 'simple', 'variation' ), true ) ) {
				return self::unsupported( 'UNSUPPORTED_PRODUCT_TYPE', $coupons );
			}

			$restore_line = array( 'productId' => $product_id );
			$variation_id = $line['variation_id'] ?? null;
			$has_variation_id = ! in_array( $variation_id, array( null, '', 0, '0' ), true );
			$attributes = $line['variation'] ?? array();
			if ( 'simple' === $type ) {
				if ( $loaded_id !== $product_id ) return self::unsupported( 'ITEMS_UNAVAILABLE', $coupons );
				if ( $has_variation_id || ! in_array( $attributes, array( null, array() ), true ) ) {
					return self::unsupported( 'INVALID_VARIATION', $coupons );
				}
				$restore_line['quantity'] = $quantity;
			} else {
				$variation_id = self::positiveId( $variation_id );
				if ( null === $variation_id || $loaded_id !== $variation_id || ! method_exists( $product, 'get_parent_id' ) || ! is_array( $attributes ) ) {
					return self::unsupported( 'INVALID_VARIATION', $coupons );
				}
				try {
					$parent_id = self::positiveId( $product->get_parent_id() );
				} catch ( \Throwable $error ) {
					self::log( 'variation_parent_unavailable' );
					return self::unsupported( 'INVALID_VARIATION', $coupons );
				}
				if ( $parent_id !== $product_id ) return self::unsupported( 'INVALID_VARIATION', $coupons );
				$restore_line['variationId'] = $variation_id;
				$restore_line['quantity'] = $quantity;
				if ( count( $attributes ) > 10 ) return self::unsupported( 'LIMIT_EXCEEDED', $coupons );
				if ( $attributes ) {
					$safe_attributes = array();
					foreach ( $attributes as $key => $value ) {
						if ( ! is_string( $key ) || ! preg_match( '/^attribute_[a-z0-9_-]{1,71}$/D', $key ) ||
							! self::safeText( $key, 80 ) || ! self::safeText( $value, 200 ) ) {
							return self::unsupported( 'INVALID_VARIATION', $coupons );
						}
						$safe_attributes[ $key ] = $value;
					}
					$restore_line['attributes'] = $safe_attributes;
				}
			}
			$restore_lines[] = $restore_line;
		}

		$supported = array(
			'schemaVersion' => self::RESTORE_VERSION,
			'kind' => 'supported',
			'appliedCouponCodes' => $coupons,
			'lines' => $restore_lines,
		);
		$encoded = wp_json_encode( $supported );
		if ( ! is_string( $encoded ) || strlen( $encoded ) > self::MAX_RESTORATION_BYTES ) {
			return self::unsupported( 'LIMIT_EXCEEDED', $coupons );
		}
		return $supported;
	}

	/** Failure carries an explicit bounded reason; no partial coupon list is returned. */
	private static function appliedCoupons( object $cart ): array {
		if ( ! method_exists( $cart, 'get_applied_coupons' ) ) {
			self::log( 'coupons_unavailable' );
			return array( 'reason' => 'COUPONS_UNAVAILABLE' );
		}
		try {
			$codes = $cart->get_applied_coupons();
		} catch ( \Throwable $error ) {
			self::log( 'coupons_unavailable' );
			return array( 'reason' => 'COUPONS_UNAVAILABLE' );
		}
		if ( ! is_array( $codes ) ) {
			self::log( 'coupons_unavailable' );
			return array( 'reason' => 'COUPONS_UNAVAILABLE' );
		}
		if ( count( $codes ) > 10 ) {
			self::log( 'coupon_limit_exceeded' );
			return array( 'reason' => 'LIMIT_EXCEEDED' );
		}
		$complete = array();
		$index = 0;
		foreach ( $codes as $key => $code ) {
			if ( $key !== $index++ || ! self::safeText( $code, 128 ) ) {
				self::log( 'coupons_unavailable' );
				return array( 'reason' => 'COUPONS_UNAVAILABLE' );
			}
			$complete[] = $code;
		}
		return array( 'codes' => $complete );
	}

	private static function unsupported( string $reason, array $coupons = array() ): array {
		self::log( 'restoration_unsupported reason=' . $reason );
		return array(
			'schemaVersion' => self::RESTORE_VERSION,
			'kind' => 'unsupported',
			'reason' => $reason,
			'appliedCouponCodes' => $coupons,
		);
	}

	private static function positiveId( mixed $value ): ?string {
		if ( ! is_int( $value ) && ! is_string( $value ) ) return null;
		$value = (string) $value;
		return strlen( $value ) <= 20 && preg_match( '/^[1-9][0-9]*$/D', $value ) ? $value : null;
	}

	private static function safeText( mixed $value, int $max ): bool {
		if ( ! is_string( $value ) || '' === $value || preg_match( '/\p{Cc}/u', $value ) ) return false;
		$length = self::utf16Length( $value );
		return null !== $length && $length <= $max;
	}

	/** Match JavaScript String.length (UTF-16 code units), used by Shared schemas. */
	private static function utf16Length( string $value ): ?int {
		$code_points = preg_match_all( '/./us', $value );
		$supplementary = preg_match_all( '/[\x{10000}-\x{10FFFF}]/u', $value );
		if ( false === $code_points || false === $supplementary ) return null;
		return $code_points + $supplementary;
	}

	private static function log( string $reason ): void {
		@error_log( 'moda.woocommerce.checkout_snapshot.' . $reason );
	}

	private static function money( mixed $amount ): ?string {
		if ( ! is_numeric( $amount ) || (float) $amount < 0 || ! is_finite( (float) $amount ) ) return null;
		// WC formats monetary amounts as decimals; API contract permits at most two places.
		$value = function_exists( 'wc_format_decimal' ) ? wc_format_decimal( $amount, 2 ) : number_format( (float) $amount, 2, '.', '' );
		return is_string( $value ) && preg_match( '/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/D', $value ) ? $value : null;
	}

	private static function putBounded( array &$target, string $key, mixed $value, int $max ): void {
		if ( ! is_string( $value ) || '' === $value || strlen( $value ) > $max * 4 ) return;
		$length = self::utf16Length( $value );
		if ( null !== $length && $length <= $max ) $target[ $key ] = $value;
	}
}
