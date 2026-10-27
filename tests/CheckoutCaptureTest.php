<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Checkout\CheckoutActivityPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutKey;
use ModaInteract\WooCommerce\Checkout\CheckoutSnapshot;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

// Bundled Composer autoload is class-map authoritative; Runtime normally loads these.
require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutKey.php';
require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutSnapshot.php';
require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutConsentPhone.php';
require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutActivityPublisher.php';
require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutCapture.php';

// Woo's Action Scheduler is present in a real installation; these stubs record its durable action arguments.
if ( ! function_exists( 'as_enqueue_async_action' ) ) {
	function as_enqueue_async_action( $hook, $args, $group, $unique ) {
		if ( ! empty( $GLOBALS['arch035_async_fail'] ) ) throw new \RuntimeException( 'action scheduler is unavailable' );
		$GLOBALS['arch035_queued'][] = compact( 'hook', 'args', 'group', 'unique' );
		return count( $GLOBALS['arch035_queued'] );
	}
}
if ( ! function_exists( 'as_schedule_single_action' ) ) {
	function as_schedule_single_action( $timestamp, $hook, $args, $group, $unique ) {
		$GLOBALS['arch035_delayed'][] = compact( 'timestamp', 'hook', 'args', 'group', 'unique' );
		return count( $GLOBALS['arch035_delayed'] );
	}
}
if ( ! function_exists( 'WC' ) ) {
	function WC() { return $GLOBALS['arch035_wc']; }
}
if ( ! function_exists( 'get_woocommerce_currency' ) ) {
	function get_woocommerce_currency() { return 'GBP'; }
}
if ( ! function_exists( 'wc_format_decimal' ) ) {
	function wc_format_decimal( $amount, $decimals = 2 ) { return number_format( (float) $amount, $decimals, '.', '' ); }
}

final class Arch035Session {
	private array $values = array();
	public function get( string $key ) { return $this->values[ $key ] ?? null; }
	public function set( string $key, mixed $value ): void { $this->values[ $key ] = $value; }
}
final class Arch035Product {
	public function get_sku(): string { return 'SKU-1'; }
	public function get_name(): string { return 'Item One'; }
}
final class Arch035Cart {
	public string $total = '29.99';
	public array $lines = array();
	public function __construct() {
		$this->lines = array( array( 'quantity' => 1, 'product_id' => 101, 'data' => new Arch035Product(), 'line_total' => '29.99' ) );
	}
	public function get_cart(): array { return $this->lines; }
	public function get_total( $context = 'view' ): string { return $this->total; }
}
final class Arch035Customer {
	public string $email = '';
	public string $phone = '';
	public function get_billing_email(): string { return $this->email; }
	public function get_billing_phone(): string { return $this->phone; }
	public function get_billing_country(): string { return 'GB'; }
	public function get_billing_first_name(): string { return ''; }
	public function get_billing_last_name(): string { return ''; }
}
final class Arch035Order {
	private array $meta = array();
	public function get_meta( string $key, bool $single = false ): mixed { return $this->meta[$key] ?? ''; }
	public function update_meta_data( string $key, string $value ): void { $this->meta[$key] = $value; }
}

final class CheckoutCaptureTest extends TestCase {
	private array $sent = array();
	private CheckoutCapture $capture;
	private CheckoutActivityPublisher $publisher;
	private bool $hadHomeUrl;
	private mixed $previousHomeUrl;

	protected function setUp(): void {
		// Other PHPUnit cases change the site's URL to a local HTTP sandbox.
		// This fixture uses a public HTTPS installation and must be independent
		// of the order in which the suites run.
		$this->hadHomeUrl = array_key_exists( 'moda_interact_home_url', $GLOBALS );
		$this->previousHomeUrl = $GLOBALS['moda_interact_home_url'] ?? null;
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['arch035_queued'] = array();
		$GLOBALS['arch035_async_fail'] = false;
		$GLOBALS['arch035_delayed'] = array();
		$GLOBALS['arch035_wc'] = (object) array(
			'session' => new Arch035Session(), 'cart' => new Arch035Cart(), 'customer' => new Arch035Customer(),
		);
		$record = array(
			'schemaVersion' => 1, 'installationId' => 'install-one', 'shopId' => 'shop-one',
			'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( "\x01", 32 ) ),
			'credentialVersion' => 1, 'connectedAt' => '2026-10-20T12:00:00.000Z',
		);
		self::assertTrue( ( new InstallationStore() )->save( $record ) );
		$this->sent = array();
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			function ( string $url, array $args ) {
				$this->sent[] = array( $url, $args );
				return array( 'response' => array( 'code' => 202 ), 'headers' => array( 'content-type' => 'application/json' ),
					'body' => '{"status":"accepted"}' );
			} );
		$identity = new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '8.8.8.8' ) );
		$this->publisher = new CheckoutActivityPublisher( $client, new InstallationStore(), $identity );
		$this->capture = new CheckoutCapture( $this->publisher );
	}

	protected function tearDown(): void {
		if ( $this->hadHomeUrl ) {
			$GLOBALS['moda_interact_home_url'] = $this->previousHomeUrl;
		} else {
			unset( $GLOBALS['moda_interact_home_url'] );
		}
		parent::tearDown();
	}

	public function test_classic_and_blocks_capture_use_one_key_but_new_ids_for_changes(): void {
		$this->capture->register();
		self::assertArrayHasKey( 'woocommerce_store_api_checkout_update_draft', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_after_calculate_totals', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_checkout_update_order_review', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_store_api_checkout_update_customer_from_request', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_checkout_create_order', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_store_api_checkout_order_processed', $GLOBALS['moda_interact_test_hooks'] );
		$this->capture->capture();
		$this->capture->capture();
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertCount( 0, $this->sent, 'shopper hook must only enqueue, never make HTTP requests' );
		$first = $GLOBALS['arch035_queued'][0]['args']['event'];
		self::assertSame( 'CHECKOUT_UPDATED', $first['eventType'] );
		self::assertSame( 'woo.activity.v1', $first['schemaVersion'] );
		self::assertSame( '29.99', $first['checkout']['total'] );
		self::assertArrayNotHasKey( 'shopId', $first );
		self::assertArrayNotHasKey( 'contact', $first['checkout'] );
		$GLOBALS['arch035_wc']->cart->total = '34.99';
		$this->capture->onClassicReview( 'billing_email=guest%40example.com&billing_first_name=Jane&billing_phone=%2B447700900001' );
		$this->capture->capture(); // classic AJAX recalculation uses saved form contact
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		$second = $GLOBALS['arch035_queued'][1]['args']['event'];
		self::assertSame( $first['checkoutKey'], $second['checkoutKey'] );
		self::assertNotSame( $first['eventId'], $second['eventId'] );
		self::assertSame( 'guest@example.com', $second['checkout']['contact']['email'] );
		self::assertSame( '+447700900001', $second['checkout']['contact']['phone'] );
		$order = new Arch035Order();
		CheckoutKey::attachToOrder( $order );
		self::assertSame( $first['checkoutKey'], $order->get_meta( CheckoutKey::ORDER_META ) );
		$GLOBALS['arch035_wc']->session->set( CheckoutKey::SESSION_FIELD, 'woo-changed-session' );
		CheckoutKey::attachToOrder( $order );
		self::assertSame( $first['checkoutKey'], $order->get_meta( CheckoutKey::ORDER_META ) );
		$GLOBALS['arch035_wc']->session->set( CheckoutKey::SESSION_FIELD, $first['checkoutKey'] );
		$this->capture->afterOrderProcessed( $order );
		$this->capture->capture();
		self::assertCount( 3, $GLOBALS['arch035_queued'] );
		self::assertNotSame( $first['checkoutKey'], $GLOBALS['arch035_queued'][2]['args']['event']['checkoutKey'] );
	}

	public function test_checkout_activity_v2_projects_verified_recipient_without_new_consent(): void {
		$GLOBALS['arch035_wc']->customer->phone = '+447400123456';
		$this->capture->capture();
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		$event = $GLOBALS['arch035_queued'][0]['args']['event'];
		self::assertSame( 'woo.activity.v2', $event['schemaVersion'] );
		self::assertSame( '447400123456', $event['checkout']['contact']['canonicalPhone'] );
		self::assertArrayNotHasKey( 'verifiedCountryCode', $event['checkout']['contact'], 'Unverified billing country is not asserted' );
		self::assertArrayNotHasKey( 'consent', $event );
		$this->publisher->deliver( ...array_values( $GLOBALS['arch035_queued'][0]['args'] ) );
		self::assertSame( '/v1/woocommerce/activity', parse_url( $this->sent[0][0], PHP_URL_PATH ) );
		self::assertSame( $event, json_decode( $this->sent[0][1]['body'], true ) );
	}

	public function test_retry_preserves_event_and_never_blocks_checkout_on_remote_failure(): void {
		$this->capture->capture();
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		$args = $GLOBALS['arch035_queued'][0]['args'];
		$this->publisher->deliver( ...array_values( $args ) );
		self::assertCount( 1, $this->sent );
		self::assertSame( '/v1/woocommerce/activity', parse_url( $this->sent[0][0], PHP_URL_PATH ) );
		self::assertSame( $args['event'], json_decode( $this->sent[0][1]['body'], true ) );
		self::assertSame( 'Bearer ' . ( new InstallationStore() )->read()['record']['credential'], $this->sent[0][1]['headers']['Authorization'] );
		// Failed transport: replays preserve identity and bounded snapshots.
		$failed = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static fn() => array( 'response' => array( 'code' => 503 ), 'headers' => array( 'content-type' => 'application/json' ), 'body' => '{"error":"queue_unavailable"}' ) );
		$retry = new CheckoutActivityPublisher( $failed, new InstallationStore(), new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '8.8.8.8' ) ) );
		$retry->deliver( ...array_values( $args ) );
		self::assertCount( 1, $GLOBALS['arch035_delayed'] );
		self::assertSame( $args['event'], $GLOBALS['arch035_delayed'][0]['args']['event'] );
		self::assertSame( 2, $GLOBALS['arch035_delayed'][0]['args']['attempt'] );
		$retry->deliver( $args['event'], $args['installationId'], $args['shopId'], 4 );
		self::assertCount( 1, $GLOBALS['arch035_delayed'] );
	}

	public function test_no_connected_installation_and_old_installation_cannot_send(): void {
		$this->capture->capture();
		$args = $GLOBALS['arch035_queued'][0]['args'];
		$store = new InstallationStore();
		$record = $store->read()['record'];
		$record['installationId'] = 'rotated-to-different-installation';
		self::assertTrue( $store->save( $record ) );
		$this->publisher->deliver( ...array_values( $args ) );
		self::assertCount( 0, $this->sent );
		$this->capture->capture(); // same snapshot suppressed even after re-connection
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
	}

	public function test_failed_action_scheduler_never_blocks_shopper_and_can_capture_later(): void {
		$GLOBALS['arch035_async_fail'] = true;
		$this->capture->capture();
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		self::assertCount( 0, $this->sent );
		$GLOBALS['arch035_async_fail'] = false;
		$this->capture->capture();
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
	}

	public function test_bounded_snapshots_omit_unavailable_contact_and_large_item_lists(): void {
		$cart = $GLOBALS['arch035_wc']->cart;
		$customer = $GLOBALS['arch035_wc']->customer;
		$customer->email = 'not-an-email';
		$snapshot = CheckoutSnapshot::fromCart( $cart, $customer );
		self::assertArrayNotHasKey( 'contact', $snapshot );
		$cart->lines = array_fill( 0, 51, array( 'quantity' => 1, 'product_id' => 1 ) );
		$snapshot = CheckoutSnapshot::fromCart( $cart, $customer );
		self::assertArrayNotHasKey( 'items', $snapshot );
	}

	public function test_cleared_classic_basket_is_published_once_and_refill_retains_checkout_key(): void {
		$this->capture->register();
		self::assertArrayHasKey( 'woocommerce_cart_item_removed', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_cart_emptied', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_store_api_checkout_update_order_from_request', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_store_api_cart_update_customer_from_request', $GLOBALS['moda_interact_test_hooks'] );

		$this->capture->capture(); // classic checkout page
		$first = $GLOBALS['arch035_queued'][0]['args']['event'];
		$GLOBALS['arch035_wc']->cart->lines = array();
		// WC may not recalculate totals after removing the final item.
		$GLOBALS['arch035_wc']->cart->total = '29.99';
		$this->capture->afterCartRemoval();
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		$empty = $GLOBALS['arch035_queued'][1]['args']['event'];
		self::assertSame( $first['checkoutKey'], $empty['checkoutKey'] );
		self::assertNotSame( $first['eventId'], $empty['eventId'] );
		self::assertSame( array( 'currency' => 'GBP', 'total' => '0.00', 'items' => array() ), $empty['checkout'] );
		self::assertSame( 'woo.activity.v1', $empty['schemaVersion'] );
		self::assertSame( 'CHECKOUT_UPDATED', $empty['eventType'] );
		self::assertSame( 'woo.activity.v1', $GLOBALS['arch035_queued'][1]['args']['event']['schemaVersion'] );
		self::assertMatchesRegularExpression( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $empty['occurredAt'] );
		self::assertSame( $empty['occurredAt'], ( new \DateTimeImmutable( $empty['occurredAt'] ) )->setTimezone( new \DateTimeZone( 'UTC' ) )->format( 'Y-m-d\TH:i:s.v\Z' ) );

		// Duplicate hooks, repeated reviews and changed form contact are not
		// new basket-empty transitions and cannot shift the abandonment clock.
		$this->capture->afterCartRemoval();
		$this->capture->onClassicReview( 'billing_email=new%40example.com' );
		$this->capture->capture();
		self::assertCount( 2, $GLOBALS['arch035_queued'] );

		$GLOBALS['arch035_wc']->cart->lines = array(
			array( 'quantity' => 2, 'product_id' => 101, 'data' => new Arch035Product(), 'line_total' => '59.98' ),
		);
		$GLOBALS['arch035_wc']->cart->total = '59.98';
		// On the cart/Store API path this hook runs after current totals exist.
		$this->capture->afterTotals();
		self::assertCount( 3, $GLOBALS['arch035_queued'] );
		$refill = $GLOBALS['arch035_queued'][2]['args']['event'];
		self::assertSame( $first['checkoutKey'], $refill['checkoutKey'] );
		self::assertNotSame( $empty['eventId'], $refill['eventId'] );
		self::assertCount( 1, $refill['checkout']['items'] );
		self::assertSame( 2, $refill['checkout']['items'][0]['quantity'] );
		self::assertSame( '59.98', $refill['checkout']['total'] );
		self::assertSame( 'new@example.com', $refill['checkout']['contact']['email'] );
		$this->capture->afterTotals();
		self::assertCount( 3, $GLOBALS['arch035_queued'] );
	}

	public function test_blocks_clear_refill_and_cart_updates_use_the_same_started_checkout(): void {
		$this->capture->register();
		$this->capture->capture(); // Blocks draft update
		$key = $GLOBALS['arch035_queued'][0]['args']['event']['checkoutKey'];
		$GLOBALS['arch035_wc']->cart->lines = array();
		$this->capture->afterCartRemoval(); // Store API remove-item hook
		self::assertSame( array(), $GLOBALS['arch035_queued'][1]['args']['event']['checkout']['items'] );
		$GLOBALS['arch035_wc']->cart->lines = array(
			array( 'quantity' => 1, 'product_id' => 305, 'line_total' => '15.00' ),
		);
		$GLOBALS['arch035_wc']->cart->total = '15.00';
		$this->capture->captureExisting(); // Store API cart-update customer hook
		self::assertCount( 3, $GLOBALS['arch035_queued'] );
		self::assertSame( $key, $GLOBALS['arch035_queued'][2]['args']['event']['checkoutKey'] );
		self::assertSame( '305', $GLOBALS['arch035_queued'][2]['args']['event']['checkout']['items'][0]['productId'] );
		$this->capture->capture(); // Blocks existing-draft PUT, no duplicate
		self::assertCount( 3, $GLOBALS['arch035_queued'] );
	}

	public function test_never_observed_empty_cart_and_cart_before_checkout_emit_no_activity(): void {
		$GLOBALS['arch035_wc']->cart->lines = array();
		$this->capture->afterCartRemoval();
		$this->capture->capture(); // initial empty checkout page
		self::assertNull( $GLOBALS['arch035_wc']->session->get( CheckoutKey::SESSION_FIELD ) );
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		self::assertSame( array( 'currency' => 'GBP', 'total' => '0.00', 'items' => array() ),
			CheckoutSnapshot::fromCart( $GLOBALS['arch035_wc']->cart, $GLOBALS['arch035_wc']->customer ) );

		// Even a session key created by another checkout extension is not proof
		// that Moda has seen a basket to cancel.
		CheckoutKey::current();
		$this->capture->capture();
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		$GLOBALS['arch035_wc']->cart->lines = array( array( 'quantity' => 1, 'line_total' => '12.00' ) );
		$GLOBALS['arch035_wc']->cart->total = '12.00';
		$this->capture->afterTotals();
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		$GLOBALS['arch035_wc']->session->set( CheckoutKey::SESSION_FIELD, 'woo-another-checkout' );
		$GLOBALS['arch035_wc']->cart->lines = array();
		$this->capture->afterCartRemoval();
		self::assertCount( 1, $GLOBALS['arch035_queued'], 'Last observed basket belongs to the previous key' );
	}

	public function test_oversized_and_invalid_snapshots_do_not_become_empty_baskets(): void {
		$cart = $GLOBALS['arch035_wc']->cart;
		$this->capture->capture();
		$first = $GLOBALS['arch035_queued'][0]['args']['event'];
		$cart->lines = array_fill( 0, 51, array( 'quantity' => 1, 'product_id' => 1 ) );
		$cart->total = '51.00';
		$this->capture->afterTotals();
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		$oversized = $GLOBALS['arch035_queued'][1]['args']['event'];
		self::assertArrayNotHasKey( 'items', $oversized['checkout'], 'Unknown item list must not claim a verified empty basket' );
		self::assertSame( $first['checkoutKey'], $oversized['checkoutKey'] );
		$this->capture->afterTotals();
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		$cart->lines = array( array( 'quantity' => 0, 'product_id' => 1 ) );
		self::assertNull( CheckoutSnapshot::fromCart( $cart, $GLOBALS['arch035_wc']->customer ) );
		$this->capture->afterTotals();
		self::assertCount( 2, $GLOBALS['arch035_queued'], 'Malformed item quantity must fail closed' );
		$cart->lines = array();
		$this->capture->afterCartRemoval();
		self::assertCount( 3, $GLOBALS['arch035_queued'] );
		self::assertSame( array(), $GLOBALS['arch035_queued'][2]['args']['event']['checkout']['items'] );
	}

	public function test_removing_one_of_multiple_items_defers_until_totals_are_current(): void {
		$cart = $GLOBALS['arch035_wc']->cart;
		$cart->lines[] = array( 'quantity' => 1, 'product_id' => 202, 'line_total' => '10.00' );
		$cart->total = '39.99';
		$this->capture->capture();
		array_pop( $cart->lines );
		$this->capture->afterCartRemoval();
		self::assertCount( 1, $GLOBALS['arch035_queued'], 'Do not publish a pre-recalculation total' );
		$cart->total = '29.99';
		$this->capture->afterTotals();
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		self::assertSame( '29.99', $GLOBALS['arch035_queued'][1]['args']['event']['checkout']['total'] );
	}

	public function test_empty_transition_enqueue_failures_can_retry_and_replay_identical_payload(): void {
		$this->capture->capture();
		$GLOBALS['arch035_wc']->cart->lines = array();
		$GLOBALS['arch035_async_fail'] = true;
		$this->capture->afterCartRemoval();
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		$GLOBALS['arch035_async_fail'] = false;
		$this->capture->afterCartRemoval();
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		$args = $GLOBALS['arch035_queued'][1]['args'];
		$this->publisher->deliver( ...array_values( $args ) );
		self::assertSame( $args['event'], json_decode( $this->sent[0][1]['body'], true ) );
		$failed = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static fn() => array( 'response' => array( 'code' => 503 ), 'headers' => array( 'content-type' => 'application/json' ),
				'body' => '{"error":"queue_unavailable"}' ) );
		$retry = new CheckoutActivityPublisher( $failed, new InstallationStore(),
			new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '8.8.8.8' ) ) );
		$retry->deliver( ...array_values( $args ) );
		self::assertCount( 1, $GLOBALS['arch035_delayed'] );
		self::assertSame( $args['event'], $GLOBALS['arch035_delayed'][0]['args']['event'] );
		self::assertSame( 2, $GLOBALS['arch035_delayed'][0]['args']['attempt'] );
		$this->capture->afterCartRemoval();
		self::assertCount( 2, $GLOBALS['arch035_queued'], 'Transport retry must not create a new checkout activity event' );
	}
}
