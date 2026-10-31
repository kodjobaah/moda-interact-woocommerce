<?php

use ModaInteract\WooCommerce\Checkout\CheckoutActivityPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutCartRestorer;
use PHPUnit\Framework\TestCase;

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

final class RestoreTestSession {
	public array $values = array();
	public function get( string $key ): mixed { return $this->values[ $key ] ?? null; }
	public function set( string $key, mixed $value ): void { $this->values[ $key ] = $value; }
}

final class RestoreTestCart {
	public array $lines = array();
	public array $coupons = array();
	public int $calculations = 0;
	public ?int $reject_product_id = null;
	public ?CheckoutCapture $capture = null;
	public function get_cart(): array { return $this->lines; }
	public function get_applied_coupons(): array { return $this->coupons; }
	public function apply_coupon( string $code ): bool { $this->coupons[] = $code; return true; }
	public function empty_cart(): void { $this->lines = array(); $this->capture?->capture(); }
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

	protected function setUp(): void {
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
	}

	public function test_preflights_all_lines_then_replaces_cart_and_commits_once(): void {
		$this->cart->lines = array( array( 'product_id' => 999, 'quantity' => 1 ) );
		$snapshot = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => array(),
			'lines' => array(
				array( 'productId' => '101', 'quantity' => 2 ),
				array( 'productId' => '202', 'variationId' => '207', 'quantity' => 1, 'attributes' => array( 'attribute_pa_size' => 'large' ) ),
			) );
		$commits = 0;
		self::assertTrue( $this->restorer->restore( $snapshot, static function () use ( &$commits ): bool { ++$commits; return true; } ) );
		self::assertSame( 1, $commits );
		self::assertSame( array( 101, 202 ), array_column( $this->cart->lines, 'product_id' ) );
		self::assertSame( 1, $this->cart->calculations );
	}

	public function test_rejects_coupon_or_late_invalid_line_before_mutating_current_cart(): void {
		$this->cart->lines = array( array( 'product_id' => 999, 'quantity' => 1 ) );
		$base = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => array(),
			'lines' => array( array( 'productId' => '101', 'quantity' => 1 ) ) );
		$coupons = $base;
		$coupons['appliedCouponCodes'] = array( 'save10' );
		$missing = $base;
		$missing['lines'][] = array( 'productId' => '404', 'quantity' => 1 );
		self::assertFalse( $this->restorer->restore( $coupons, static fn(): bool => true ) );
		self::assertFalse( $this->restorer->restore( $missing, static fn(): bool => true ) );
		self::assertSame( array( 999 ), array_column( $this->cart->lines, 'product_id' ) );
		self::assertSame( 0, $this->cart->calculations );
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