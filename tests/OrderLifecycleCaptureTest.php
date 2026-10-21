<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Checkout\CheckoutActivityPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutKey;
use ModaInteract\WooCommerce\Checkout\OrderLifecycleCapture;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutKey.php';
require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutActivityPublisher.php';
require_once dirname( __DIR__ ) . '/includes/Checkout/OrderLifecycleCapture.php';

if ( ! function_exists( 'as_enqueue_async_action' ) ) {
	function as_enqueue_async_action( $hook, $args, $group, $unique ) {
		if ( ! empty( $GLOBALS['arch035_async_fail'] ) ) throw new \RuntimeException( 'scheduler unavailable' );
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
if ( ! function_exists( 'wc_get_order' ) ) {
	function wc_get_order( $id ) { return $GLOBALS['arch035_order_lookup'][ $id ] ?? false; }
}

final class Arch035LifecycleOrder {
	private array $meta = array();
	public string $status = 'pending';
	public int $meta_saves = 0;

	public function __construct( private readonly int $id, ?string $checkout_key = 'woo-session-fixture' ) {
		if ( null !== $checkout_key ) $this->meta[ CheckoutKey::ORDER_META ] = $checkout_key;
	}
	public function get_id(): int { return $this->id; }
	public function get_status(): string { return $this->status; }
	public function get_meta( string $key, bool $single = false ): mixed { return $this->meta[ $key ] ?? ''; }
	public function update_meta_data( string $key, mixed $value ): void { $this->meta[ $key ] = $value; }
	public function delete_meta_data( string $key ): void { unset( $this->meta[ $key ] ); }
	public function save_meta_data(): void { $this->meta_saves++; }
}

final class OrderLifecycleCaptureTest extends TestCase {
	private OrderLifecycleCapture $capture;
	private CheckoutActivityPublisher $publisher;
	private array $requests = array();
	private array $originals = array();

	protected function setUp(): void {
		foreach ( array( 'moda_interact_home_url', 'moda_interact_options', 'arch035_async_fail', 'arch035_queued', 'arch035_delayed', 'arch035_order_lookup' ) as $key ) {
			$this->originals[ $key ] = array( array_key_exists( $key, $GLOBALS ), $GLOBALS[ $key ] ?? null );
		}
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['arch035_async_fail'] = false;
		$GLOBALS['arch035_queued'] = array();
		$GLOBALS['arch035_delayed'] = array();
		$GLOBALS['arch035_order_lookup'] = array();
		self::assertTrue( ( new InstallationStore() )->save( array(
			'schemaVersion' => 1, 'installationId' => 'woo-install', 'shopId' => 'woo-shop',
			'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( "\x01", 32 ) ),
			'credentialVersion' => 1, 'connectedAt' => '2026-10-20T12:00:00.000Z',
		) ) );
		$this->requests = array();
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			function ( string $url, array $args ) {
				$this->requests[] = array( $url, $args );
				return array( 'response' => array( 'code' => 202 ), 'headers' => array( 'content-type' => 'application/json' ),
					'body' => '{"status":"accepted"}' );
			} );
		$this->publisher = new CheckoutActivityPublisher( $client, new InstallationStore(),
			new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '8.8.8.8' ) ) );
		$this->capture = new OrderLifecycleCapture( $this->publisher );
	}

	protected function tearDown(): void {
		foreach ( $this->originals as $key => [ $existed, $value ] ) {
			if ( $existed ) $GLOBALS[ $key ] = $value;
			else unset( $GLOBALS[ $key ] );
		}
		parent::tearDown();
	}

	private function event( int $index ): array {
		return $GLOBALS['arch035_queued'][ $index ]['args']['event'];
	}

	public function test_classic_and_blocks_placement_are_deduplicated_without_payment_inference(): void {
		$this->capture->register();
		self::assertArrayHasKey( 'woocommerce_checkout_order_processed', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_store_api_checkout_order_processed', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_payment_complete', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'woocommerce_order_status_changed', $GLOBALS['moda_interact_test_hooks'] );
		$order = new Arch035LifecycleOrder( 702 );
		$GLOBALS['arch035_order_lookup'][702] = $order;
		$this->capture->onPlaced( 702 ); // Classic supplies an order ID.
		$this->capture->onPlaced( $order ); // Blocks supplies an order object.
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertSame( 'ORDER_PLACED', $this->event( 0 )['eventType'] );
		self::assertSame( '702', $this->event( 0 )['order']['orderId'] );
		self::assertSame( $this->event( 0 )['checkoutKey'], $this->event( 0 )['order']['checkoutKey'] );
		self::assertArrayNotHasKey( 'shopId', $this->event( 0 ) );
		self::assertArrayNotHasKey( 'checkout', $this->event( 0 ) );
		self::assertCount( 0, $this->requests, 'Order hook must never send HTTPS on checkout path' );
		self::assertSame( 2, $order->meta_saves, 'Immutable record and queued acknowledgment are saved by order APIs' );
	}

	public function test_paid_cancelled_and_reopened_cancellation_have_distinct_stable_ids(): void {
		$order = new Arch035LifecycleOrder( 703 );
		$GLOBALS['arch035_order_lookup'][703] = $order;
		$this->capture->onPlaced( $order );
		$order->status = 'processing';
		$this->capture->onPaid( 703 );
		$this->capture->onPaid( 703 );
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		self::assertSame( 'ORDER_PAID', $this->event( 1 )['eventType'] );
		$order->status = 'cancelled';
		$this->capture->onStatusChanged( 703, 'processing', 'cancelled', $order );
		$this->capture->onStatusChanged( 703, 'processing', 'cancelled', $order );
		self::assertCount( 3, $GLOBALS['arch035_queued'] );
		self::assertSame( 'ORDER_CANCELLED', $this->event( 2 )['eventType'] );
		$order->status = 'pending';
		$this->capture->onStatusChanged( 703, 'cancelled', 'pending', $order );
		$order->status = 'cancelled';
		$this->capture->onStatusChanged( 703, 'pending', 'cancelled', $order );
		self::assertCount( 4, $GLOBALS['arch035_queued'] );
		self::assertSame( 'ORDER_CANCELLED', $this->event( 3 )['eventType'] );
		self::assertNotSame( $this->event( 2 )['eventId'], $this->event( 3 )['eventId'] );
		self::assertCount( 4, array_unique( array_column( array_map( fn( $action ) => $action['args']['event'], $GLOBALS['arch035_queued'] ), 'eventId' ) ) );
	}

	public function test_failed_queue_retries_original_event_after_repeated_hook_and_never_guesses_identity(): void {
		$order = new Arch035LifecycleOrder( 704 );
		$GLOBALS['arch035_order_lookup'][704] = $order;
		$GLOBALS['arch035_async_fail'] = true;
		$this->capture->onPlaced( $order );
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		$original = $order->get_meta( '_moda_order_activity_v1_ORDER_PLACED', true )['event'];
		$GLOBALS['arch035_async_fail'] = false;
		$this->capture->onPlaced( $order );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertSame( $original, $this->event( 0 ) );
		$missing = new Arch035LifecycleOrder( 705, null );
		$this->capture->onPlaced( $missing );
		$this->capture->onPaid( 705 );
		$this->capture->onStatusChanged( 705, 'pending', 'cancelled', $missing );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertSame( 0, $missing->meta_saves );
	}

	public function test_order_delivery_uses_activity_route_with_identical_503_retry_and_shop_binding(): void {
		$order = new Arch035LifecycleOrder( 706 );
		$this->capture->onPlaced( $order );
		$args = $GLOBALS['arch035_queued'][0]['args'];
		$this->publisher->deliver( ...array_values( $args ) );
		self::assertCount( 1, $this->requests );
		self::assertSame( '/v1/woocommerce/activity', parse_url( $this->requests[0][0], PHP_URL_PATH ) );
		self::assertSame( $args['event'], json_decode( $this->requests[0][1]['body'], true ) );
		$failure = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static fn() => array( 'response' => array( 'code' => 503 ), 'body' => '{"error":"unavailable"}' ) );
		$retry_publisher = new CheckoutActivityPublisher( $failure, new InstallationStore(),
			new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '8.8.8.8' ) ) );
		$retry_publisher->deliver( ...array_values( $args ) );
		self::assertSame( $args['event'], $GLOBALS['arch035_delayed'][0]['args']['event'] );
		self::assertSame( 2, $GLOBALS['arch035_delayed'][0]['args']['attempt'] );
		$installation = ( new InstallationStore() )->read()['record'];
		$installation['installationId'] = 'another-installation';
		self::assertTrue( ( new InstallationStore() )->save( $installation ) );
		$this->publisher->deliver( ...array_values( $args ) );
		self::assertCount( 1, $this->requests, 'Rotated installation must never receive old checkout/order activity' );
	}
}
