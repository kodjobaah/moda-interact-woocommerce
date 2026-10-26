<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Capture-only Woo order lifecycle observer; order metadata is HPOS compatible. */
final class OrderLifecycleCapture {
	private const META_PREFIX = '_moda_order_activity_v1_';

	public function __construct( private readonly CheckoutActivityPublisher $publisher ) {}

	public function register(): void {
		// Both checkout hooks run before gateway payment. They mean placed, never paid.
		add_action( 'woocommerce_checkout_order_processed', array( $this, 'onPlaced' ), 20, 3 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( $this, 'onPlaced' ), 20, 1 );
		// Some gateways set an authoritative Woo paid status without calling
		// payment_complete(). All three hooks converge on one validated paid event.
		add_action( 'woocommerce_payment_complete', array( $this, 'onPaid' ), 10, 1 );
		add_action( 'woocommerce_order_payment_status_changed', array( $this, 'onPaid' ), 10, 1 );
		add_action( 'woocommerce_order_status_changed', array( $this, 'onStatusChanged' ), 10, 4 );
	}

	/** Classic supplies an ID; Store API supplies a WC_Order object. */
	public function onPlaced( mixed $order_id_or_order ): void {
		$this->capture( $order_id_or_order, 'ORDER_PLACED' );
		// If a gateway already advanced the order before this hook acquired the
		// checkout key, recover the observed terminal state. Placement alone is
		// still never treated as evidence of payment.
		try {
			$order = $this->resolve( $order_id_or_order );
			if ( self::confirmedPaid( $order ) ) $this->capture( $order, 'ORDER_PAID' );
			elseif ( null !== $order && 'cancelled' === $order->get_status() ) $this->capture( $order, 'ORDER_CANCELLED' );
		} catch ( \Throwable $error ) {
			self::log( 'placement_reconciliation_failed' );
		}
	}

	public function onPaid( mixed $order_id ): void {
		try {
			$order = $this->resolve( $order_id );
			if ( self::confirmedPaid( $order ) ) $this->capture( $order, 'ORDER_PAID' );
		} catch ( \Throwable $error ) {
			self::log( 'paid_observation_failed' );
		}
	}

	public function onStatusChanged( mixed $order_id, mixed $from, mixed $to, mixed $order = null ): void {
		try {
			if ( ! is_string( $from ) || ! is_string( $to ) || $from === $to ) return;
			$resolved = $this->resolve( $order ?? $order_id );
			if ( null === $resolved ) return;
			// Ignore stale callbacks: only the *current* order state is evidence.
			if ( $resolved->get_status() !== $to ) return;
			if ( 'cancelled' === $from && 'cancelled' !== $to ) {
				$record = $resolved->get_meta( self::META_PREFIX . 'ORDER_CANCELLED', true );
				// Never discard an occurrence that Action Scheduler failed to enqueue.
				// A new cancellation after an enqueued one receives its own eventId.
				if ( is_array( $record ) && ( $record['enqueued'] ?? false ) === true ) {
					$resolved->delete_meta_data( self::META_PREFIX . 'ORDER_CANCELLED' );
					$resolved->save_meta_data();
				}
			} elseif ( 'cancelled' === $to ) {
				$this->capture( $resolved, 'ORDER_CANCELLED' );
			}
			// Woo sets date_paid when entering its paid statuses even when a
			// gateway never fires woocommerce_payment_complete. A failed, on-hold,
			// refunded, or merely placed order is never a payment signal.
			if ( self::confirmedPaid( $resolved ) ) $this->capture( $resolved, 'ORDER_PAID' );
		} catch ( \Throwable $error ) {
			// A third-party store failure must not break the order state change.
			self::log( 'state_save_failed' );
		}
	}

	private function capture( mixed $order_id_or_order, string $type ): void {
		try {
			$order = $this->resolve( $order_id_or_order );
			if ( null === $order ) return;
			$order_id = $order->get_id();
			if ( ! is_int( $order_id ) || $order_id < 1 ) return;
			$checkout_key = $order->get_meta( CheckoutKey::ORDER_META, true );
			if ( ! CheckoutKey::valid( $checkout_key ) ) {
				self::log( 'checkout_key_missing' );
				return;
			}
			$status = $order->get_status();
			if ( ! is_string( $status ) || ! preg_match( '/^[a-z][a-z0-9_-]{0,63}$/D', $status ) ) return;
			$meta_key = self::META_PREFIX . $type;
			$record = $order->get_meta( $meta_key, true );
			if ( ! self::sameEvent( $record, $type, (string) $order_id, $checkout_key ) ) {
				$record = array(
					'event' => array(
						'schemaVersion' => 'woo.activity.v1',
						'eventId' => 'woo-' . bin2hex( random_bytes( 16 ) ),
						'eventType' => $type,
						'checkoutKey' => $checkout_key,
						'occurredAt' => gmdate( 'Y-m-d\TH:i:s' ) . '.000Z',
						'order' => array( 'orderId' => (string) $order_id, 'checkoutKey' => $checkout_key, 'status' => $status ),
					),
					'enqueued' => false,
				);
				// Persist the immutable event before enqueue so failed scheduling can
				// retry the same identity on a repeated source hook.
				$order->update_meta_data( $meta_key, $record );
				$order->save_meta_data();
			}
			if ( $record['enqueued'] ) return;
			if ( ! $this->publisher->enqueueOrder( $record['event'] ) ) {
				self::log( 'enqueue_failed', $record['event']['eventId'] );
				return;
			}
			$record['enqueued'] = true;
			$order->update_meta_data( $meta_key, $record );
			$order->save_meta_data();
		} catch ( \Throwable $error ) {
			// Never interrupt Woo checkout, payment or cancellation transitions.
			self::log( 'capture_failed' );
		}
	}

	private function resolve( mixed $order_id_or_order ): ?object {
		$order = is_object( $order_id_or_order ) ? $order_id_or_order :
			( function_exists( 'wc_get_order' ) ? wc_get_order( $order_id_or_order ) : null );
		foreach ( array( 'get_id', 'get_meta', 'get_status', 'update_meta_data', 'save_meta_data', 'delete_meta_data' ) as $method ) {
			if ( ! is_object( $order ) || ! method_exists( $order, $method ) ) return null;
		}
		return $order;
	}

	/** Use Woo's paid-status semantics, with explicit unpaid/terminal exclusions. */
	private static function confirmedPaid( ?object $order ): bool {
		if ( null === $order || ! method_exists( $order, 'is_paid' ) || ! function_exists( 'wc_get_is_paid_statuses' ) ) return false;
		$status = $order->get_status();
		if ( ! is_string( $status ) || in_array( $status,
			array( 'pending', 'on-hold', 'failed', 'cancelled', 'refunded', 'trash', 'checkout-draft', 'draft', 'auto-draft' ), true ) ) return false;
		$paid_statuses = wc_get_is_paid_statuses();
		return is_array( $paid_statuses ) && in_array( $status, $paid_statuses, true ) && true === $order->is_paid();
	}

	private static function sameEvent( mixed $record, string $type, string $order_id, string $checkout_key ): bool {
		$event = is_array( $record ) ? ( $record['event'] ?? null ) : null;
		return is_array( $event ) && is_bool( $record['enqueued'] ?? null ) &&
			( $event['schemaVersion'] ?? null ) === 'woo.activity.v1' &&
			( $event['eventType'] ?? null ) === $type &&
			CheckoutKey::valid( $event['eventId'] ?? null ) &&
			( $event['checkoutKey'] ?? null ) === $checkout_key &&
			CheckoutKey::valid( $event['checkoutKey'] ?? null ) &&
			is_string( $event['occurredAt'] ?? null ) &&
			( $event['order']['orderId'] ?? null ) === $order_id &&
			( $event['order']['checkoutKey'] ?? null ) === $checkout_key &&
			is_string( $event['order']['status'] ?? null );
	}

	private static function log( string $reason, ?string $event_id = null ): void {
		// Never log order payloads, customer information or installation secrets.
		$safe_id = is_string( $event_id ) && preg_match( '/^woo-[0-9a-f]{32}$/D', $event_id ) ? ' eventId=' . $event_id : '';
		error_log( 'moda.woocommerce.order_activity.' . $reason . $safe_id );
	}
}
