<?php

use ModaInteract\WooCommerce\Checkout\CheckoutActivityPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutCartRestorer;
use ModaInteract\WooCommerce\Checkout\CheckoutCouponRestorer;
use PHPUnit\Framework\TestCase;

if ( ! class_exists( '\WC_Cart' ) ) { class WC_Cart {} }

if ( ! class_exists( '\\WC_Product_Simple' ) ) {
	class WC_Product_Simple {
		public function __construct( private int $id ) {}
		public function get_id(): int { return $this->id; }
		public function get_type(): string { return 'simple'; }
		public function is_purchasable(): bool { return true; }
		public function is_in_stock(): bool { return true; }
		public function has_enough_stock( int $quantity ): bool { return true; }
		public function is_sold_individually(): bool { return false; }
	}
}
if ( ! class_exists( '\\WC_Product_Variable' ) ) {
	class WC_Product_Variable {
		public function __construct( private int $id ) {}
		public function get_type(): string { return 'variable'; }
	}
}
if ( ! class_exists( '\\WC_Product_Variation' ) ) {
	class WC_Product_Variation {
		public function __construct( private int $id, private int $parent_id, private array $attributes ) {}
		public function get_id(): int { return $this->id; }
		public function get_type(): string { return 'variation'; }
		public function get_parent_id(): int { return $this->parent_id; }
		public function get_variation_attributes(): array { return $this->attributes; }
		public function is_purchasable(): bool { return true; }
		public function is_in_stock(): bool { return true; }
		public function has_enough_stock( int $quantity ): bool { return true; }
		public function is_sold_individually(): bool { return false; }
	}
}
if ( ! function_exists( 'wc_get_product' ) ) {
	function wc_get_product( $id ) { return $GLOBALS['restore_test_products'][ (int) $id ] ?? null; }
}
if ( ! function_exists( 'WC' ) ) {
	function WC() { return $GLOBALS['arch035_wc'] ?? null; }
}
if ( ! function_exists( 'wc_get_logger' ) ) {
	function wc_get_logger() {
		return $GLOBALS['moda_interact_test_logger'] ?? new class {
			public function error( string $message, array $context = array() ): void {}
		};
	}
}
if ( ! function_exists( 'add_filter' ) ) {
	function add_filter( string $hook, callable $callback, int $priority = 10, int $accepted_args = 1 ): bool {
		$GLOBALS['arch053_test_filters'][ $hook ][] = $callback;
		return true;
	}
}
if ( ! function_exists( 'remove_filter' ) ) {
	function remove_filter( string $hook, callable $callback, int $priority = 10 ): bool {
		foreach ( array( 'arch053_test_filters', 'arch046_checkbox_filters' ) as $registry ) {
			if ( ! is_array( $GLOBALS[ $registry ][ $hook ] ?? null ) ) continue;
			$GLOBALS[ $registry ][ $hook ] = array_values( array_filter(
				$GLOBALS[ $registry ][ $hook ], static fn( $registered ): bool => $registered !== $callback
			) );
		}
		return true;
	}
}

final class RestoreTestSession {
	public array $values = array();
	public function get( string $key ): mixed { return $this->values[ $key ] ?? null; }
	public function set( string $key, mixed $value ): void { $this->values[ $key ] = $value; }
}

final class RestoreTestCart extends WC_Cart {
	public array $lines = array();
	public array $coupons = array();
	public int $calculations = 0;
	public ?int $reject_product_id = null;
	public array $rejected_coupon_codes = array();
	public array $coupon_attempts = array();
	public ?string $throw_coupon_code = null;
	public string $throw_coupon_message = 'coupon service failed';
	public ?CheckoutCapture $capture = null;
	public function get_cart(): array { return $this->lines; }
	public function get_applied_coupons(): array { return $this->coupons; }
	public function remove_coupon( string $code ): void { $this->coupons = array_values( array_filter( $this->coupons, static fn( $current ): bool => strtolower( $current ) !== strtolower( $code ) ) ); }
	public function apply_coupon( string $code ): bool {
		$this->coupon_attempts[] = $code;
		if ( $code === $this->throw_coupon_code ) throw new RuntimeException( $this->throw_coupon_message );
		if ( in_array( strtolower( $code ), $this->rejected_coupon_codes, true ) ) {
			$message = 'Coupon code ' . $code . ' is invalid.';
			foreach ( array( 'arch053_test_filters', 'arch046_checkbox_filters' ) as $registry ) {
				foreach ( $GLOBALS[ $registry ]['woocommerce_coupon_error'] ?? array() as $filter ) $message = $filter( $message );
			}
			foreach ( array( 'arch053_test_filters', 'arch046_checkbox_filters' ) as $registry ) {
				foreach ( $GLOBALS[ $registry ]['woocommerce_add_error'] ?? array() as $filter ) $message = $filter( $message );
			}
			if ( '' !== $message ) $GLOBALS['restore_test_error_notices'][] = $message;
			$GLOBALS['restore_test_error_notices'][] = 'unrelated extension error';
			return false;
		}
		$this->coupons[] = strtolower( $code );
		return true;
	}
	public function empty_cart(): void { $this->lines = array(); $this->coupons = array(); $this->capture?->capture(); }
	public function add_to_cart( int $product_id, int $quantity, int $variation_id = 0, array $variation = array(), array $item_data = array() ): string|false {
		if ( $product_id === $this->reject_product_id ) return false;
		$this->lines[] = array_merge( array( 'product_id' => $product_id, 'variation_id' => $variation_id,
			'quantity' => $quantity, 'variation' => $variation ), $item_data );
		return 'line-' . count( $this->lines );
	}
	public function calculate_totals(): void { ++$this->calculations; }
}

final class CheckoutCartRestorerTest extends TestCase {
	private CheckoutCapture $capture;
	private CheckoutCartRestorer $restorer;
	private RestoreTestCart $cart;
	private mixed $previous_test_logger;
	private object $logger;

	protected function setUp(): void {
		$this->previous_test_logger = $GLOBALS['moda_interact_test_logger'] ?? null;
		$this->logger = new class {
			public array $errors = array();
			public function error( string $message, array $context = array() ): void { $this->errors[] = array( $message, $context ); }
		};
		$GLOBALS['moda_interact_test_logger'] = $this->logger;
		$this->capture = new CheckoutCapture( new CheckoutActivityPublisher() );
		$this->restorer = new CheckoutCartRestorer( $this->capture );
		$this->cart = new RestoreTestCart();
		$this->cart->capture = $this->capture;
		$GLOBALS['arch035_wc'] = (object) array( 'cart' => $this->cart, 'session' => new RestoreTestSession(), 'customer' => null );
		$GLOBALS['restore_test_products'] = array(
			101 => new WC_Product_Simple( 101 ),
			202 => new WC_Product_Variable( 202 ),
			207 => new WC_Product_Variation( 207, 202, array( 'attribute_pa_size' => 'large' ) ),
			999 => new WC_Product_Simple( 999 ),
		);
		$GLOBALS['restore_test_error_notices'] = array( 'unrelated Woo notice' );
	}

	protected function tearDown(): void {
		if ( null === $this->previous_test_logger ) unset( $GLOBALS['moda_interact_test_logger'] );
		else $GLOBALS['moda_interact_test_logger'] = $this->previous_test_logger;
		parent::tearDown();
	}

	public function test_preflights_all_lines_then_replaces_cart_and_commits_once(): void {
		$this->cart->lines = array( array( 'product_id' => 999, 'quantity' => 1 ) );
		$snapshot = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => array(),
			'lines' => array(
				array( 'productId' => '101', 'quantity' => 2 ),
				array( 'productId' => '202', 'variationId' => '207', 'quantity' => 1, 'attributes' => array( 'attribute_pa_size' => 'large' ) ),
			) );
		$commits = 0;
		$result = $this->restorer->restore( $snapshot, static function () use ( &$commits ): bool { ++$commits; return true; } );
		self::assertIsArray( $result );
		self::assertSame( array(), $result['appliedCodes'] );
		self::assertSame( array(), $result['rejectedCodes'] );
		self::assertTrue( $result['cartTotalRecalculated'] );
		self::assertSame( 1, $commits );
		self::assertSame( array( 101, 202 ), array_column( $this->cart->lines, 'product_id' ) );
		self::assertSame( 1, $this->cart->calculations );
	}

	public function test_allows_coupon_bearing_snapshot_but_rejects_late_invalid_line_before_mutating_current_cart(): void {
		$this->cart->lines = array( array( 'product_id' => 999, 'quantity' => 1 ) );
		$base = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => array(),
			'lines' => array( array( 'productId' => '101', 'quantity' => 1 ) ) );
		$coupons = $base;
		$coupons['appliedCouponCodes'] = array( 'save10' );
		$malformed_coupon = $base;
		$malformed_coupon['appliedCouponCodes'] = array( str_repeat( 'x', 129 ) );
		$missing = $base;
		$missing['lines'][] = array( 'productId' => '404', 'quantity' => 1 );
		self::assertFalse( $this->restorer->restore( $malformed_coupon, static fn(): bool => true ) );
		$this->cart->rejected_coupon_codes = array( 'save10' );
		$result = $this->restorer->restore( $coupons, static fn(): bool => true );
		self::assertSame( array( 'save10' ), $result['rejectedCodes'] );
		self::assertFalse( $this->restorer->restore( $missing, static fn(): bool => true ) );
		self::assertSame( array( 101 ), array_column( $this->cart->lines, 'product_id' ) );
		self::assertSame( 1, $this->cart->calculations );
		self::assertSame( array( 'save10' ), $this->cart->coupon_attempts );
	}

	public function test_applies_confirmed_offer_after_originals_and_calculates_once(): void {
		$snapshot = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => array( 'save10' ),
			'lines' => array( array( 'productId' => '101', 'quantity' => 1 ) ) );
		$result = $this->restorer->restore( $snapshot, static fn(): bool => true,
			array( 'kind' => 'CHECKOUT_CODE', 'code' => 'extra15', 'providerDiscountId' => 'woo:coupon:15' ) );
		self::assertSame( array( 'save10' ), $result['appliedCodes'] );
		self::assertSame( 'APPLIED', $result['outreachOffer']['outcome'] );
		self::assertSame( array( 'save10', 'extra15' ), $this->cart->coupons );
		self::assertSame( 1, $this->cart->calculations );
	}

	public function test_coupon_restorer_continues_after_rejections_and_reports_actual_subset(): void {
		$rejected = array( 'expired', 'deleted', 'usage-exhausted', 'minimum-spend', 'product-excluded', 'non-stackable' );
		$this->cart->rejected_coupon_codes = $rejected;
		$codes = array_merge( array( 'valid' ), $rejected, array( 'valid-later' ) );
		$result = ( new CheckoutCouponRestorer() )->restore( $this->cart, $codes );
		self::assertSame( array( 'valid', 'valid-later' ), $result['appliedCodes'] );
		self::assertSame( $rejected, $result['rejectedCodes'] );
		self::assertTrue( $result['cartTotalRecalculated'] );
		self::assertSame( $codes, $this->cart->coupon_attempts );
		self::assertSame( 1, $this->cart->calculations );
		self::assertSame( array( 'unrelated Woo notice', 'unrelated extension error', 'unrelated extension error', 'unrelated extension error', 'unrelated extension error', 'unrelated extension error', 'unrelated extension error' ), $GLOBALS['restore_test_error_notices'],
			'Only Woo coupon rejection errors are suppressed; pre-existing and unrelated errors remain untouched.' );
	}

	public function test_unexpected_coupon_error_rolls_back_cart_and_does_not_commit(): void {
		$this->cart->lines = array( array( 'product_id' => 999, 'quantity' => 1, 'variation_id' => 0, 'variation' => array() ) );
		$this->cart->throw_coupon_code = 'save10';
		$this->cart->throw_coupon_message = 'Coupon code SAVE10 dependency failed for +44 7700 900123';
		$snapshot = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => array( 'save10' ),
			'lines' => array( array( 'productId' => '101', 'quantity' => 1 ) ) );
		$commits = 0;
		self::assertFalse( $this->restorer->restore( $snapshot, static function () use ( &$commits ): bool { ++$commits; return true; } ) );
		self::assertSame( 0, $commits );
		self::assertSame( array( 999 ), array_column( $this->cart->lines, 'product_id' ) );
		self::assertSame( 1, $this->cart->calculations, 'Only rollback totals are recalculated after coupon application fails.' );
		self::assertCount( 1, $this->logger->errors );
		[ $message, $context ] = $this->logger->errors[0];
		self::assertSame( 'restore_apply_failed', $context['reason'] );
		self::assertStringContainsString( 'dependency failed', $context['error_message'] );
		self::assertStringNotContainsString( 'SAVE10', $message . (string) json_encode( $context ) );
		self::assertStringNotContainsString( '7700 900123', $message . (string) json_encode( $context ) );
	}

	public function test_mid_apply_failure_restores_the_original_cart_and_does_not_commit(): void {
		$this->cart->lines = array( array( 'product_id' => 999, 'quantity' => 2, 'variation_id' => 0, 'variation' => array(), 'data' => new WC_Product_Simple( 999 ) ) );
		$this->cart->reject_product_id = 101;
		$snapshot = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => array(),
			'lines' => array( array( 'productId' => '101', 'quantity' => 1 ) ) );
		$commits = 0;
		self::assertFalse( $this->restorer->restore( $snapshot, static function () use ( &$commits ): bool { ++$commits; return true; } ) );
		self::assertSame( 0, $commits );
		self::assertSame( array( 999 ), array_column( $this->cart->lines, 'product_id' ) );
		self::assertSame( 2, $this->cart->lines[0]['quantity'] );
		self::assertSame( 1, $this->cart->calculations, 'Only the rollback cart totals are calculated' );
	}

	public function test_commit_failure_rolls_back_after_restoration_without_intermediate_capture(): void {
		$this->cart->lines = array( array( 'product_id' => 999, 'quantity' => 1 ) );
		$snapshot = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => array(),
			'lines' => array( array( 'productId' => '101', 'quantity' => 1 ) ) );
		$capture_calls = 0;
		self::assertFalse( $this->restorer->restore( $snapshot, static function () use ( &$capture_calls ): bool { ++$capture_calls; return false; } ) );
		self::assertSame( 1, $capture_calls );
		self::assertSame( array( 999 ), array_column( $this->cart->lines, 'product_id' ) );
	}
}
