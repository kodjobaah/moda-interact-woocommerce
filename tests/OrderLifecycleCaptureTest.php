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
if ( ! function_exists( 'wc_get_is_paid_statuses' ) ) {
	function wc_get_is_paid_statuses(): array { return $GLOBALS['arch048_paid_statuses'] ?? array( 'processing', 'completed' ); }
}

/** PHP unit analogue of the Action Scheduler failed-action store. */
final class Arch048Action {
	public function __construct( private array $args, private string $hook, private string $group ) {}
	public function get_args(): array { return $this->args; }
	public function get_hook(): string { return $this->hook; }
	public function get_group(): string { return $this->group; }
}
final class Arch048ActionStore {
	public array $actions = array();
	public function get_status( int $id ): string { return $this->actions[ $id ]['status'] ?? ''; }
	public function fetch_action( int $id ): Arch048Action { return $this->actions[ $id ]['action']; }
}
if ( ! class_exists( 'ActionScheduler' ) ) {
	class ActionScheduler {
		public static ?Arch048ActionStore $fixture = null;
		public static function store(): Arch048ActionStore { return self::$fixture ??= new Arch048ActionStore(); }
	}
}

final class Arch035LifecycleOrder {
	private array $meta = array();
	public string $status = 'pending';
	public ?bool $paid_override = null;
	public string $transaction_id = '';
	public string $payment_method = 'cod';
	public bool $has_date_paid = false;
	public int $meta_saves = 0;

	public function __construct( private readonly int $id, ?string $checkout_key = 'woo-session-fixture' ) {
		if ( null !== $checkout_key ) $this->meta[ CheckoutKey::ORDER_META ] = $checkout_key;
	}
	public function get_id(): int { return $this->id; }
	public function get_status(): string { return $this->status; }
	public function is_paid(): bool { return $this->paid_override ?? in_array( $this->status, wc_get_is_paid_statuses(), true ); }
	public function get_transaction_id(): string { return $this->transaction_id; }
	public function get_payment_method(): string { return $this->payment_method; }
	public function get_date_paid(): ?\DateTimeImmutable { return $this->has_date_paid ? new \DateTimeImmutable() : null; }
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
		foreach ( array( 'moda_interact_home_url', 'moda_interact_options', 'arch035_async_fail', 'arch035_queued', 'arch035_delayed', 'arch035_order_lookup', 'arch048_paid_statuses' ) as $key ) {
			$this->originals[ $key ] = array( array_key_exists( $key, $GLOBALS ), $GLOBALS[ $key ] ?? null );
		}
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['arch035_async_fail'] = false;
		$GLOBALS['arch035_queued'] = array();
		$GLOBALS['arch035_delayed'] = array();
		$GLOBALS['arch035_order_lookup'] = array();
		$GLOBALS['arch048_paid_statuses'] = array( 'processing', 'completed' );
		ActionScheduler::$fixture = new Arch048ActionStore();
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
		self::assertSame( 'onPaymentComplete', $GLOBALS['moda_interact_test_hooks']['woocommerce_payment_complete'][0][1] );
		self::assertSame( 'onPaid', $GLOBALS['moda_interact_test_hooks']['woocommerce_order_payment_status_changed'][0][1] );
		self::assertArrayHasKey( 'woocommerce_order_payment_status_changed', $GLOBALS['moda_interact_test_hooks'] );
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
		$order->transaction_id = 'gateway-703';
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

	public function test_paid_status_hooks_cover_gateways_without_guessing_payment_from_placement_or_unpaid_status(): void {
		$order = new Arch035LifecycleOrder( 712 );
		$GLOBALS['arch035_order_lookup'][712] = $order;
		$this->capture->onPlaced( $order ); // Classic or Blocks order creation.
		foreach ( array( 'on-hold', 'failed', 'pending' ) as $status ) {
			$previous = $order->status;
			$order->status = $status;
			$this->capture->onStatusChanged( 712, $previous, $status, $order );
			$this->capture->onPaid( 712 ); // Incorrect gateway callback must not imply paid.
		}
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		$order->status = 'processing';
		$order->transaction_id = 'gateway-712';
		$this->capture->onStatusChanged( 712, 'pending', 'processing', $order );
		$this->capture->onPaid( 712 ); // Woo payment-status-changed and payment-complete.
		$this->capture->onPaid( 712 );
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		self::assertSame( 'ORDER_PAID', $this->event( 1 )['eventType'] );
		self::assertSame( $this->event( 0 )['checkoutKey'], $this->event( 1 )['checkoutKey'] );
		$order->status = 'completed';
		$this->capture->onStatusChanged( 712, 'processing', 'completed', $order );
		$order->status = 'refunded';
		$this->capture->onStatusChanged( 712, 'completed', 'refunded', $order );
		$this->capture->onPaid( 712 );
		self::assertCount( 2, $GLOBALS['arch035_queued'], 'Completed/refunded transitions cannot forge a second paid event' );
		self::assertSame( $this->event( 1 )['eventId'], $order->get_meta( '_moda_order_activity_v1_ORDER_PAID', true )['event']['eventId'] );
	}

	public function test_cod_paid_status_and_automatic_date_paid_never_confirm_collection(): void {
		$order = new Arch035LifecycleOrder( 719 );
		$order->payment_method = 'cod';
		$order->status = 'processing'; // Woo COD sets processing at placement, without receiving money.
		$order->has_date_paid = true; // Woo may automatically set date_paid during this status change.
		$GLOBALS['arch035_order_lookup'][719] = $order;
		$this->capture->onPlaced( $order );
		$this->capture->onPaid( 719 ); // The status-based payment hook isn't proof either.
		$this->capture->onStatusChanged( 719, 'pending', 'processing', $order );
		self::assertCount( 1, $GLOBALS['arch035_queued'], 'COD placement cannot produce ORDER_PAID' );
		self::assertSame( 'ORDER_PLACED', $this->event( 0 )['eventType'] );
		self::assertSame( '', $order->get_meta( '_moda_order_activity_v1_ORDER_PAID', true ) );

		// Even a status-only completed transition still requires independent evidence.
		$order->status = 'completed';
		$this->capture->onStatusChanged( 719, 'processing', 'completed', $order );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		// Woo's actual payment-complete callback, without a transaction ID, is explicit confirmation.
		$this->capture->onPaymentComplete( 719 );
		$this->capture->onPaymentComplete( 719 );
		$this->capture->onPaid( 719 );
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		self::assertSame( 'ORDER_PAID', $this->event( 1 )['eventType'] );
		self::assertSame( $this->event( 0 )['checkoutKey'], $this->event( 1 )['checkoutKey'] );
	}

	public function test_status_only_gateway_requires_nonempty_transaction_reference_and_paid_state(): void {
		$order = new Arch035LifecycleOrder( 720 );
		$order->payment_method = 'gateway-no-payment-complete';
		$GLOBALS['arch035_order_lookup'][720] = $order;
		$this->capture->onPlaced( $order );
		$order->status = 'processing';
		$order->transaction_id = '  ';
		$this->capture->onStatusChanged( 720, 'pending', 'processing', $order );
		$this->capture->onPaid( 720 );
		self::assertCount( 1, $GLOBALS['arch035_queued'], 'Whitespace is not a payment reference' );
		$order->status = 'on-hold';
		$order->transaction_id = 'gateway-confirmation-720';
		$this->capture->onPaid( 720 ); // Not paid even with a transaction reference.
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		$order->status = 'processing';
		$this->capture->onStatusChanged( 720, 'on-hold', 'processing', $order );
		$this->capture->onPaid( 720 );
		self::assertCount( 2, $GLOBALS['arch035_queued'], 'A gateway can confirm without payment_complete()' );
		self::assertSame( 'ORDER_PAID', $this->event( 1 )['eventType'] );
		self::assertSame( 'gateway-confirmation-720', $order->get_transaction_id() );
		self::assertSame( $this->event( 0 )['checkoutKey'], $this->event( 1 )['checkoutKey'] );
	}

	public function test_payment_complete_callback_does_not_forge_paid_or_unlinked_orders(): void {
		$order = new Arch035LifecycleOrder( 721 );
		$this->capture->onPaymentComplete( $order ); // Woo still has an unpaid status.
		$order->status = 'processing';
		$order->paid_override = false;
		$this->capture->onPaymentComplete( $order );
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		$order->paid_override = true;
		$this->capture->onPaymentComplete( $order );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		$unlinked = new Arch035LifecycleOrder( 722, null );
		$unlinked->status = 'processing';
		$this->capture->onPaymentComplete( $unlinked );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
	}

	public function test_late_classic_or_blocks_placement_reconciles_an_already_terminal_woo_order(): void {
		$paid = new Arch035LifecycleOrder( 717 );
		$paid->status = 'completed';
		$paid->transaction_id = 'gateway-717';
		$this->capture->onPlaced( $paid );
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		self::assertSame( 'ORDER_PLACED', $this->event( 0 )['eventType'] );
		self::assertSame( 'ORDER_PAID', $this->event( 1 )['eventType'] );
		self::assertSame( $this->event( 0 )['checkoutKey'], $this->event( 1 )['checkoutKey'] );
		$this->capture->onPlaced( $paid );
		self::assertCount( 2, $GLOBALS['arch035_queued'] );

		$cancelled = new Arch035LifecycleOrder( 718 );
		$cancelled->status = 'cancelled';
		$this->capture->onPlaced( $cancelled );
		self::assertCount( 4, $GLOBALS['arch035_queued'] );
		self::assertSame( 'ORDER_CANCELLED', $this->event( 3 )['eventType'] );
		self::assertSame( $this->event( 2 )['checkoutKey'], $this->event( 3 )['checkoutKey'] );
	}

	public function test_paid_status_is_restricted_to_actual_woocommerce_paid_semantics_even_with_custom_filters(): void {
		$order = new Arch035LifecycleOrder( 713 );
		$GLOBALS['arch048_paid_statuses'] = array( 'processing', 'completed', 'fulfilled', 'on-hold' );
		$order->status = 'on-hold';
		$this->capture->onPaid( $order ); // Excluded even if a filter calls it paid.
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		$order->status = 'fulfilled';
		$order->paid_override = false;
		$this->capture->onStatusChanged( 713, 'on-hold', 'fulfilled', $order );
		self::assertCount( 0, $GLOBALS['arch035_queued'], 'Woo is_paid() must also confirm paid' );
		$order->paid_override = true;
		$order->transaction_id = 'gateway-713';
		$this->capture->onPaid( $order );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertSame( 'fulfilled', $this->event( 0 )['order']['status'] );
		$order->status = 'failed';
		$this->capture->onStatusChanged( 713, 'fulfilled', 'processing', $order ); // stale callback.
		$this->capture->onPaid( $order );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
	}

	public function test_unscheduled_cancellation_is_not_lost_on_reopen_and_never_turns_failed_into_paid(): void {
		$order = new Arch035LifecycleOrder( 714 );
		$order->status = 'processing';
		$order->transaction_id = 'gateway-714';
		$this->capture->onPaid( $order );
		$GLOBALS['arch035_async_fail'] = true;
		$order->status = 'cancelled';
		$this->capture->onStatusChanged( 714, 'processing', 'cancelled', $order );
		$unsent = $order->get_meta( '_moda_order_activity_v1_ORDER_CANCELLED', true );
		self::assertFalse( $unsent['enqueued'] );
		$order->status = 'pending';
		$this->capture->onStatusChanged( 714, 'cancelled', 'pending', $order );
		self::assertSame( $unsent, $order->get_meta( '_moda_order_activity_v1_ORDER_CANCELLED', true ) );
		$GLOBALS['arch035_async_fail'] = false;
		$order->status = 'cancelled';
		$this->capture->onStatusChanged( 714, 'pending', 'cancelled', $order );
		self::assertSame( $unsent['event'], $this->event( 1 ) );
		$order->status = 'failed';
		$this->capture->onStatusChanged( 714, 'cancelled', 'failed', $order );
		$order->status = 'refunded';
		$this->capture->onStatusChanged( 714, 'failed', 'refunded', $order );
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		self::assertSame( 'ORDER_PAID', $this->event( 0 )['eventType'] );
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
		try {
			$this->publisher->deliver( ...array_values( $args ) );
			self::fail( 'Old installation order action must be FAILED, not silently completed' );
		} catch ( \RuntimeException $error ) {
			self::assertStringContainsString( 'reason=installation_changed', $error->getMessage() );
		}
		self::assertCount( 1, $this->requests, 'Rotated installation must never receive old checkout/order activity' );
	}

	public function test_exhaustion_and_permanent_rejection_fail_action_scheduler_with_bounded_non_pii_evidence(): void {
		$this->capture->onPlaced( new Arch035LifecycleOrder( 715 ) );
		$args = $GLOBALS['arch035_queued'][0]['args'];
		$failure = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static fn() => array( 'response' => array( 'code' => 503 ), 'body' => '{"error":"unavailable"}' ) );
		$retry = new CheckoutActivityPublisher( $failure, new InstallationStore(),
			new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '8.8.8.8' ) ) );
		foreach ( array( 1, 2, 3 ) as $attempt ) {
			$retry->deliver( $args['event'], $args['installationId'], $args['shopId'], $attempt );
		}
		self::assertCount( 3, $GLOBALS['arch035_delayed'] );
		foreach ( $GLOBALS['arch035_delayed'] as $index => $action ) {
			self::assertSame( $args['event'], $action['args']['event'] );
			self::assertSame( $index + 2, $action['args']['attempt'] );
		}
		try {
			$retry->deliver( $args['event'], $args['installationId'], $args['shopId'], 4 );
			self::fail( 'Action Scheduler must record final unsuccessful order delivery as failed' );
		} catch ( \RuntimeException $error ) {
			self::assertStringContainsString( 'reason=retry_exhausted', $error->getMessage() );
			self::assertStringContainsString( 'eventId=' . $args['event']['eventId'], $error->getMessage() );
			self::assertStringNotContainsString( $args['event']['checkoutKey'], $error->getMessage() );
			self::assertStringNotContainsString( 'orderId', $error->getMessage() );
		}
		$rejection = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static fn() => array( 'response' => array( 'code' => 400 ), 'body' => '{"error":"sensitive-customer-data"}' ) );
		$rejected = new CheckoutActivityPublisher( $rejection, new InstallationStore(),
			new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '8.8.8.8' ) ) );
		try {
			$rejected->deliver( ...array_values( $args ) );
			self::fail( 'Permanent HTTP failure must not be recorded as delivered' );
		} catch ( \RuntimeException $error ) {
			self::assertStringContainsString( 'reason=rejected', $error->getMessage() );
			self::assertStringNotContainsString( 'sensitive-customer-data', $error->getMessage() );
		}
		self::assertCount( 3, $GLOBALS['arch035_delayed'], '4xx must not be retried' );
		$unschedulable = new CheckoutActivityPublisher( $failure, new InstallationStore(),
			new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '8.8.8.8' ) ), static fn() => 0 );
		try {
			$unschedulable->deliver( ...array_values( $args ) );
			self::fail( 'An unscheduled retry must also be a durable failed action' );
		} catch ( \RuntimeException $error ) {
			self::assertStringContainsString( 'reason=retry_schedule_failed', $error->getMessage() );
		}
	}

	public function test_operator_replay_only_accepts_failed_order_action_bound_to_current_site_and_shop(): void {
		$this->capture->onPlaced( new Arch035LifecycleOrder( 716 ) );
		$args = $GLOBALS['arch035_queued'][0]['args'];
		$store = ActionScheduler::store();
		$store->actions[27] = array( 'status' => 'failed', 'action' => new Arch048Action( $args,
			CheckoutActivityPublisher::ACTION, 'moda-interact-activity' ) );
		$store->actions[28] = array( 'status' => 'complete', 'action' => $store->actions[27]['action'] );
		$store->actions[29] = array( 'status' => 'failed', 'action' => new Arch048Action( $args,
			'not_moda_activity', 'moda-interact-activity' ) );
		self::assertFalse( $this->publisher->replayFailedOrder( 28 ) );
		self::assertFalse( $this->publisher->replayFailedOrder( 29 ) );
		self::assertTrue( $this->publisher->replayFailedOrder( 27 ) );
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
		self::assertSame( $args['event'], $GLOBALS['arch035_queued'][1]['args']['event'] );
		self::assertSame( 1, $GLOBALS['arch035_queued'][1]['args']['attempt'] );
		$installation = ( new InstallationStore() )->read()['record'];
		$installation['installationId'] = 'rotated';
		self::assertTrue( ( new InstallationStore() )->save( $installation ) );
		self::assertFalse( $this->publisher->replayFailedOrder( 27 ) );
		self::assertCount( 2, $GLOBALS['arch035_queued'] );
	}
}
