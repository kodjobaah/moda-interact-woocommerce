<?php

use ModaInteract\WooCommerce\Checkout\CheckoutActivityPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutCartRestorer;
use ModaInteract\WooCommerce\Checkout\CheckoutResumeController;
use ModaInteract\WooCommerce\Checkout\CheckoutKey;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

if ( ! class_exists( '\WC_Cart' ) ) { class WC_Cart {} }
if ( ! function_exists( 'WC' ) ) { function WC() { return $GLOBALS['arch035_wc'] ?? null; } }
if ( ! class_exists( '\\WC_Product_Simple' ) ) {
	class WC_Product_Simple {
		public function __construct( private int $id ) {}
		public function get_id(): int { return $this->id; }
		public function get_type(): string { return 'simple'; }
		public function get_sku(): string { return 'SKU-' . $this->id; }
		public function get_name(): string { return 'Product ' . $this->id; }
		public function is_purchasable(): bool { return true; }
		public function is_in_stock(): bool { return true; }
		public function has_enough_stock( int $quantity ): bool { return true; }
		public function is_sold_individually(): bool { return false; }
	}
}
if ( ! function_exists( 'wc_get_product' ) ) {
	function wc_get_product( $id ) { return $GLOBALS['restore_test_products'][ (int) $id ] ?? null; }
}
if ( ! function_exists( 'get_woocommerce_currency' ) ) { function get_woocommerce_currency() { return 'GBP'; } }
if ( ! function_exists( 'wc_format_decimal' ) ) { function wc_format_decimal( $amount, $decimals = 2 ) { return number_format( (float) $amount, $decimals, '.', '' ); } }
if ( ! function_exists( 'wc_get_checkout_url' ) ) { function wc_get_checkout_url() { return 'https://merchant.example/shop/checkout'; } }
if ( ! function_exists( 'wc_get_cart_url' ) ) { function wc_get_cart_url() { return home_url( '/' ); } }
if ( ! function_exists( 'as_enqueue_async_action' ) ) {
	function as_enqueue_async_action( $hook, $args, $group, $unique ) {
		if ( ! empty( $GLOBALS['arch035_async_fail'] ) ) throw new RuntimeException( 'Action Scheduler unavailable' );
		$GLOBALS['resume_test_actions'][] = compact( 'hook', 'args', 'group', 'unique' );
		return count( $GLOBALS['resume_test_actions'] );
	}
}

final class ResumeControllerSession {
	public array $values = array();
	public bool $cookie_set = false;
	public bool $fail_next_save = false;
	public int $save_calls = 0;
	public function get( string $key ): mixed { return $this->values[ $key ] ?? null; }
	public function set( string $key, mixed $value ): void { $this->values[ $key ] = $value; }
	public function set_customer_session_cookie( bool $set ): void { $this->cookie_set = $set; }
	public function save_data(): void {
		++$this->save_calls;
		if ( $this->fail_next_save ) {
			$this->fail_next_save = false;
			throw new RuntimeException( 'session persistence failed' );
		}
	}
}

final class ResumeControllerCart extends WC_Cart {
	public array $lines = array();
	public array $coupons = array();
	public ?string $throw_coupon_code = null;
	public function get_cart(): array { return $this->lines; }
	public function get_applied_coupons(): array { return $this->coupons; }
	public function empty_cart(): void { $this->lines = array(); $this->coupons = array(); }
	public function add_to_cart( int $product_id, int $quantity, int $variation_id = 0, array $variation = array(), array $item_data = array() ): string|false {
		$this->lines[] = array_merge( array( 'product_id' => $product_id, 'variation_id' => $variation_id, 'quantity' => $quantity, 'variation' => $variation,
			'data' => wc_get_product( $variation_id ?: $product_id ) ), $item_data );
		return 'line-' . count( $this->lines );
	}
	public function calculate_totals(): void {}
	public function get_total( string $context = 'view' ): string { return '29.99'; }
	public function apply_coupon( string $code ): bool {
		if ( $code === $this->throw_coupon_code ) throw new RuntimeException( 'Coupon code ' . $code . ' dependency unavailable for +44 7700 900123' );
		$this->coupons[] = strtolower( $code );
		return true;
	}
	public function remove_coupon( string $code ): void { $this->coupons = array_values( array_filter( $this->coupons, static fn( $current ): bool => strtolower( $current ) !== strtolower( $code ) ) ); }
}

final class CheckoutResumeControllerTest extends TestCase {
	private CheckoutResumeController $controller;
	private ResumeControllerSession $session;
	private int $resolve_count = 0;
	private mixed $previous_home_url;
	private mixed $previous_test_logger;

	protected function setUp(): void {
		$this->previous_test_logger = $GLOBALS['moda_interact_test_logger'] ?? null;
		$GLOBALS['moda_interact_test_logger'] = new class {
			public function error( string $message, array $context = array() ): void {}
		};
		$this->previous_home_url = $GLOBALS['moda_interact_home_url'] ?? null;
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example/shop';
	$GLOBALS['restore_test_products'] = array();
	$GLOBALS['resume_test_actions'] = array();
	$GLOBALS['arch035_queued'] = array();
	$GLOBALS['arch035_async_fail'] = false;
		$this->session = new ResumeControllerSession();
		$GLOBALS['arch035_wc'] = (object) array( 'session' => $this->session, 'cart' => new stdClass(), 'customer' => null );
		$capture = new CheckoutCapture( new CheckoutActivityPublisher() );
		$this->controller = new CheckoutResumeController( $capture, new CheckoutCartRestorer( $capture ), null,
			function (): array { ++$this->resolve_count; return array(); } );
	}

	protected function tearDown(): void {
		$GLOBALS['moda_interact_home_url'] = $this->previous_home_url;
		if ( null === $this->previous_test_logger ) unset( $GLOBALS['moda_interact_test_logger'] );
		else $GLOBALS['moda_interact_test_logger'] = $this->previous_test_logger;
		parent::tearDown();
	}

	public function test_get_and_head_are_read_only_excluding_bounded_visitor_confirmation_evidence(): void {
		$query = array( 'moda_interact_resume' => '1', 'r' => 'recovery_456', 't' => str_repeat( 'A', 43 ) );
		$head = $this->controller->handleRequest( 'HEAD', '/shop/', $query, array(), array() );
		self::assertSame( '', $head['body'] );
		self::assertSame( 'no-store', $head['headers']['Cache-Control'] );
		self::assertSame( 'no-referrer', $head['headers']['Referrer-Policy'] );
		self::assertSame( array(), $this->session->values );
		$get = $this->controller->handleRequest( 'GET', '/shop/', $query, array(), array() );
		self::assertSame( 200, $get['status'] );
		self::assertSame( 'text/html; charset=utf-8', $get['headers']['Content-Type'] );
		self::assertStringContainsString( 'Replace current basket and continue', $get['body'] );
		self::assertStringContainsString( str_repeat( 'A', 43 ), $get['body'] );
		self::assertStringNotContainsString( 'woo-example-checkout', $get['body'] );
		self::assertStringNotContainsString( '<script', $get['body'] );
		self::assertTrue( $this->session->cookie_set );
		self::assertIsArray( $this->session->get( 'moda_interact_restore_nonce_v1' ) );
		self::assertSame( 0, $this->resolve_count );
	}

	public function test_link_is_bound_to_merchant_home_subpath_and_forged_post_never_resolves(): void {
		self::assertNull( $this->controller->handleRequest( 'GET', '/shop/child/', array(
			'moda_interact_resume' => '1', 'r' => 'recovery_456', 't' => str_repeat( 'A', 43 ),
		), array(), array() ) );
		$body = array( 'moda_interact_resume' => '1', 'r' => 'recovery_456', 't' => str_repeat( 'A', 43 ),
			'nonce' => str_repeat( 'B', 43 ), 'confirm' => 'replace' );
		$response = $this->controller->handleRequest( 'POST', '/shop/', array(), $body, array(
			'HTTP_ORIGIN' => 'https://attacker.example', 'CONTENT_LENGTH' => '250',
		) );
		self::assertSame( 'https://merchant.example/shop', $response['redirect'] );
		self::assertSame( 0, $this->resolve_count );
	}

	public function test_malformed_get_redirects_without_error_marker_or_error_html(): void {
		$response = $this->controller->handleRequest( 'GET', '/shop/', array(
			'moda_interact_resume' => '1', 'r' => 'not valid', 't' => 'short',
		), array(), array() );
		self::assertArrayHasKey( 'redirect', $response );
		self::assertStringNotContainsString( 'error', $response['redirect'] );
		self::assertSame( '', $response['body'] );
		self::assertSame( 0, $this->resolve_count );
	}

	public function test_session_persistence_failure_rolls_back_cart_and_session_state(): void {
		$GLOBALS['restore_test_products'] = array( 101 => new WC_Product_Simple( 101 ) );
		$cart = new ResumeControllerCart();
		$cart->lines = array( array( 'product_id' => 999, 'variation_id' => 0, 'quantity' => 2, 'variation' => array() ) );
		$GLOBALS['arch035_wc']->cart = $cart;
		$nonce = str_repeat( 'B', 43 );
		$prior_nonce = array( 'digest' => hash( 'sha256', $nonce ), 'issuedAt' => time() );
		$prior_completed = array( 'recoveryId' => 'previous-recovery', 'completedAt' => 123 );
		$prior_capture = array( 'checkoutKey' => 'woo-existing-checkout', 'fingerprint' => 'prior-fingerprint' );
		$this->session->values = array(
			'moda_interact_restore_nonce_v1' => $prior_nonce,
			'moda_interact_checkout_last_capture_v1' => $prior_capture,
			'moda_interact_restore_completed_v1' => $prior_completed,
		);
		$this->session->fail_next_save = true;
		$connection = array(
			'schemaVersion' => 1, 'installationId' => 'install-one', 'shopId' => 'shop-one',
			'canonicalSiteUrl' => 'https://merchant.example/shop',
			'credential' => Base64Url::encode( str_repeat( "\x02", 32 ) ), 'credentialVersion' => 1,
			'connectedAt' => '2026-10-20T12:00:00.000Z',
		);
		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = $connection;
		$response = json_decode( file_get_contents( __DIR__ . '/fixtures/woo-restore-v1.json' ), true )['eligibleResolveResponse'];
		$response['checkoutKey'] = 'woo-restored-checkout';
		$response['snapshot'] = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => array(),
			'lines' => array( array( 'productId' => '101', 'quantity' => 1 ) ) );
		$response['outreachOffer'] = array( 'kind' => 'NONE', 'reason' => 'NO_CONFIRMED_OFFER' );
		$capture = new CheckoutCapture( new CheckoutActivityPublisher() );
		$this->controller = new CheckoutResumeController( $capture, new CheckoutCartRestorer( $capture ), new InstallationStore(),
			static fn() => $response, new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ) );
		$before_cart = $cart->lines;
		$post = array( 'moda_interact_resume' => '1', 'r' => 'recovery_456', 't' => str_repeat( 'A', 43 ), 'nonce' => $nonce, 'confirm' => 'replace' );
		$result = $this->controller->handleRequest( 'POST', '/shop/', array(), $post, array(
			'HTTP_ORIGIN' => 'https://merchant.example', 'CONTENT_LENGTH' => '512',
		) );

		self::assertSame( home_url( '/' ), $result['redirect'] );
		self::assertSame( array( 999 ), array_column( $cart->lines, 'product_id' ) );
		self::assertSame( array_column( $before_cart, 'quantity' ), array_column( $cart->lines, 'quantity' ) );
		self::assertNull( $this->session->get( CheckoutKey::SESSION_FIELD ) );
		self::assertSame( $prior_nonce, $this->session->get( 'moda_interact_restore_nonce_v1' ) );
		self::assertSame( $prior_completed, $this->session->get( 'moda_interact_restore_completed_v1' ) );
		self::assertSame( $prior_capture, $this->session->get( 'moda_interact_checkout_last_capture_v1' ) );
		self::assertSame( 2, $this->session->save_calls, 'The rollback session state is persisted after the failed commit.' );
		self::assertSame( array(), $GLOBALS['resume_test_actions'], 'Session persistence must succeed before a resumption activity is enqueued.' );
	}

	public function test_activity_enqueue_failure_rolls_back_cart_and_session_state(): void {
		$cart = new ResumeControllerCart();
		$cart->lines = array( array( 'product_id' => 999, 'variation_id' => 0, 'quantity' => 2, 'variation' => array() ) );
		$post = $this->prepareRestorePost( $cart, str_repeat( 'B', 43 ) );
		$GLOBALS['arch035_async_fail'] = true;
		try {
			$result = $this->controller->handleRequest( 'POST', '/shop/', array(), $post, array(
				'HTTP_ORIGIN' => 'https://merchant.example', 'CONTENT_LENGTH' => '512',
			) );
		} finally {
			$GLOBALS['arch035_async_fail'] = false;
		}

		self::assertSame( home_url( '/' ), $result['redirect'] );
		self::assertSame( array( 999 ), array_column( $cart->lines, 'product_id' ) );
		self::assertSame( array( 2 ), array_column( $cart->lines, 'quantity' ) );
		self::assertNull( $this->session->get( CheckoutKey::SESSION_FIELD ) );
		self::assertSame( array( 'recoveryId' => 'previous-recovery', 'completedAt' => 123 ), $this->session->get( 'moda_interact_restore_completed_v1' ) );
		self::assertSame( array( 'checkoutKey' => 'woo-existing-checkout', 'fingerprint' => 'prior-fingerprint' ), $this->session->get( 'moda_interact_checkout_last_capture_v1' ) );
		self::assertSame( 2, $this->session->save_calls, 'The rollback session state is persisted after enqueue failure.' );
		self::assertSame( array(), $GLOBALS['resume_test_actions'] );
	}

	public function test_coupon_dependency_failure_rolls_back_and_redirects_without_frontend_error(): void {
		$cart = new ResumeControllerCart();
		$cart->lines = array( array( 'product_id' => 999, 'variation_id' => 0, 'quantity' => 2, 'variation' => array() ) );
		$cart->throw_coupon_code = 'SAVE10';
		$post = $this->prepareRestorePost( $cart, str_repeat( 'B', 43 ), array( 'SAVE10' ) );

		$result = $this->controller->handleRequest( 'POST', '/shop/', array(), $post, array(
			'HTTP_ORIGIN' => 'https://merchant.example', 'CONTENT_LENGTH' => '512',
		) );

		self::assertSame( home_url( '/' ), $result['redirect'] );
		self::assertStringNotContainsString( 'SAVE10', $result['redirect'] );
		self::assertStringNotContainsString( '7700 900123', $result['redirect'] );
		self::assertSame( array( 999 ), array_column( $cart->lines, 'product_id' ) );
		self::assertSame( array( 2 ), array_column( $cart->lines, 'quantity' ) );
		self::assertNull( $this->session->get( CheckoutKey::SESSION_FIELD ) );
		self::assertSame( array(), $GLOBALS['resume_test_actions'] );
	}

	public function test_confirmed_offer_is_applied_after_original_coupon_and_resolver_outage_leaves_cart_unchanged(): void {
		$cart = new ResumeControllerCart();
		$cart->lines = array( array( 'product_id' => 999, 'variation_id' => 0, 'quantity' => 1, 'variation' => array() ) );
		$this->prepareRestorePost( $cart, str_repeat( 'C', 43 ), array( 'SAVE10' ), array( 'kind' => 'CHECKOUT_CODE', 'code' => 'EXTRA15', 'providerDiscountId' => 'woo:coupon:15' ) );
		$post = array( 'moda_interact_resume' => '1', 'r' => 'recovery_456', 't' => str_repeat( 'A', 43 ), 'nonce' => str_repeat( 'C', 43 ), 'confirm' => 'replace' );
		$result = $this->controller->handleRequest( 'POST', '/shop/', array(), $post, array( 'HTTP_ORIGIN' => 'https://merchant.example', 'CONTENT_LENGTH' => '512' ) );
		self::assertSame( wc_get_checkout_url(), $result['redirect'] );
		self::assertSame( array( 'save10', 'extra15' ), $cart->coupons );
		self::assertSame( 1, $this->resolve_count );
		self::assertCount( 1, $GLOBALS['arch035_queued'], 'Confirmed offer processing emits one final checkout activity.' );

		$before_lines = $cart->lines;
		$this->prepareRestorePost( $cart, str_repeat( 'D', 43 ), array(), null, static function (): array { throw new RuntimeException( 'API unavailable' ); } );
		$post['nonce'] = str_repeat( 'D', 43 );
		$result = $this->controller->handleRequest( 'POST', '/shop/', array(), $post, array( 'HTTP_ORIGIN' => 'https://merchant.example', 'CONTENT_LENGTH' => '512' ) );
		self::assertSame( home_url( '/' ), $result['redirect'] );
		self::assertSame( $before_lines, $cart->lines );
		self::assertSame( array( 'save10', 'extra15' ), $cart->coupons );
	}

	private function prepareRestorePost( ResumeControllerCart $cart, string $nonce, array $coupon_codes = array(), ?array $offer = null, ?callable $resolver = null ): array {
		$GLOBALS['restore_test_products'] = array( 101 => new WC_Product_Simple( 101 ) );
		$GLOBALS['arch035_wc']->cart = $cart;
		$prior_nonce = array( 'digest' => hash( 'sha256', $nonce ), 'issuedAt' => time() );
		$this->session->values = array(
			'moda_interact_restore_nonce_v1' => $prior_nonce,
			'moda_interact_checkout_last_capture_v1' => array( 'checkoutKey' => 'woo-existing-checkout', 'fingerprint' => 'prior-fingerprint' ),
			'moda_interact_restore_completed_v1' => array( 'recoveryId' => 'previous-recovery', 'completedAt' => 123 ),
		);
		$connection = array(
			'schemaVersion' => 1, 'installationId' => 'install-one', 'shopId' => 'shop-one',
			'canonicalSiteUrl' => 'https://merchant.example/shop',
			'credential' => Base64Url::encode( str_repeat( "\x02", 32 ) ), 'credentialVersion' => 1,
			'connectedAt' => '2026-10-20T12:00:00.000Z',
		);
		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = $connection;
		$response = json_decode( file_get_contents( __DIR__ . '/fixtures/woo-restore-v1.json' ), true )['eligibleResolveResponse'];
		$response['checkoutKey'] = 'woo-restored-checkout';
		$response['snapshot'] = array( 'schemaVersion' => 'woo.cart-restore.v1', 'kind' => 'supported', 'appliedCouponCodes' => $coupon_codes,
			'lines' => array( array( 'productId' => '101', 'quantity' => 1 ) ) );
		$response['outreachOffer'] = $offer ?? array( 'kind' => 'NONE', 'reason' => 'NO_CONFIRMED_OFFER' );
		$capture = new CheckoutCapture( new CheckoutActivityPublisher() );
		$this->controller = new CheckoutResumeController( $capture, new CheckoutCartRestorer( $capture ), new InstallationStore(),
			$resolver ?? function () use ( $response ): array { ++$this->resolve_count; return $response; },
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ) );
		return array( 'moda_interact_resume' => '1', 'r' => 'recovery_456', 't' => str_repeat( 'A', 43 ), 'nonce' => $nonce, 'confirm' => 'replace' );
	}
}
