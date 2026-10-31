<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Supported Classic and Store API / Checkout Blocks checkout hooks. */
final class CheckoutCapture {
	private const LAST_CAPTURE = 'moda_interact_checkout_last_capture_v1';
	private array $classicContact = array();

	public function __construct( private readonly CheckoutActivityPublisher $publisher ) {}

	public function register(): void {
		$this->publisher->register();
		// Classic checkout: initial page and the recalculated AJAX checkout review.
		add_action( 'woocommerce_before_checkout_form', array( $this, 'capture' ), 10, 0 );
		add_action( 'woocommerce_checkout_update_order_review', array( $this, 'onClassicReview' ), 10, 1 );
		// WC skips after_calculate_totals when the basket becomes empty, so
		// explicit post-removal hooks are needed to cancel an observed checkout.
		add_action( 'woocommerce_after_calculate_totals', array( $this, 'afterTotals' ), 10, 0 );
		add_action( 'woocommerce_cart_item_removed', array( $this, 'afterCartRemoval' ), 10, 0 );
		add_action( 'woocommerce_cart_emptied', array( $this, 'afterCartRemoval' ), 10, 0 );
		// Coupon actions run after Woo has updated the cart's applied-code list.
		// Observe only an existing checkout generation; coupon hooks can also run
		// from the ordinary cart where checkout capture has not begun.
		add_action( 'woocommerce_applied_coupon', array( $this, 'onCouponChange' ), 10, 1 );
		add_action( 'woocommerce_removed_coupon', array( $this, 'onCouponChange' ), 10, 1 );
		// Checkout Blocks: the supported PATCH draft hook has current cart/customer state.
		add_action( 'woocommerce_store_api_checkout_update_draft', array( $this, 'capture' ), 10, 1 );
		add_action( 'woocommerce_store_api_checkout_update_order_from_request', array( $this, 'capture' ), 10, 2 );
		add_action( 'woocommerce_store_api_cart_update_customer_from_request', array( $this, 'captureExisting' ), 10, 2 );
		add_action( 'woocommerce_store_api_checkout_update_customer_from_request', array( $this, 'capture' ), 10, 2 );
		// Order object APIs work in HPOS; no post_meta or direct SQL writes.
		add_action( 'woocommerce_checkout_create_order', array( CheckoutKey::class, 'attachToOrder' ), 10, 1 );
		add_action( 'woocommerce_store_api_checkout_update_order_meta', array( CheckoutKey::class, 'attachToOrder' ), 10, 1 );
		add_action( 'woocommerce_checkout_order_processed', array( $this, 'afterOrderProcessed' ), 10, 3 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( $this, 'afterOrderProcessed' ), 10, 1 );
	}

	/** Classic AJAX update has form contact before Woo recalculates cart totals. */
	public function onClassicReview( mixed $post_data ): void {
		$this->classicContact = array();
		if ( ! is_string( $post_data ) || strlen( $post_data ) > 8192 ) return;
		parse_str( $post_data, $values );
		foreach ( array( 'billing_first_name' => array( 'firstName', 100 ), 'billing_last_name' => array( 'lastName', 100 ) ) as $source => $description ) {
			$value = $values[ $source ] ?? null;
			if ( ! is_string( $value ) ) continue;
			$value = trim( strip_tags( $value ) );
			if ( '' !== $value && preg_match_all( '/./us', $value, $characters ) && count( $characters[0] ) <= $description[1] ) {
				$this->classicContact[ $description[0] ] = $value;
			}
		}
		$email = $values['billing_email'] ?? null;
		if ( is_string( $email ) && strlen( $email ) <= 254 && filter_var( $email, FILTER_VALIDATE_EMAIL ) ) $this->classicContact['email'] = $email;
		$phone = $values['billing_phone'] ?? null;
		if ( is_string( $phone ) && preg_match( '/^\+?[0-9 ()-]{5,32}$/D', $phone ) ) $this->classicContact['phone'] = $phone;
	}

	public function afterTotals(): void {
		// Classic review may establish a new key. Other cart/Store API totals
		// changes are observed only if the checkout already has a session key.
		if ( defined( 'WOOCOMMERCE_CHECKOUT' ) && constant( 'WOOCOMMERCE_CHECKOUT' ) ) {
			$this->capture();
		} else {
			$this->captureExisting();
		}
	}

	/** Woo's cart-item removal and empty-cart hooks run after lines are cleared. */
	public function afterCartRemoval(): void {
		try {
			$cart = WC()->cart ?? null;
			if ( is_object( $cart ) && method_exists( $cart, 'get_cart' ) && array() === $cart->get_cart() ) {
				$this->captureExisting();
			}
		} catch ( \Throwable $error ) {
			self::log( 'cart_removal_capture_unavailable', $error );
		}
	}

	/** Coupon hooks provide a code, but the canonical complete list comes from the cart. */
	public function onCouponChange( mixed $_coupon_code ): void {
		$this->captureExisting();
	}

	/** A cart route is not itself evidence that checkout has begun. */
	public function captureExisting(): void {
		try {
			$session = WC()->session ?? null;
			if ( $session && CheckoutKey::valid( $session->get( CheckoutKey::SESSION_FIELD ) ) ) $this->capture();
		} catch ( \Throwable $error ) {
			self::log( 'existing_capture_unavailable', $error );
		}
	}

	/** One checkout/order generation ends; the next cart must receive a fresh key. */
	public function afterOrderProcessed( mixed $order_id_or_order ): void {
		try {
			$order = is_object( $order_id_or_order ) ? $order_id_or_order :
				( function_exists( 'wc_get_order' ) ? wc_get_order( $order_id_or_order ) : null );
			if ( ! is_object( $order ) || ! method_exists( $order, 'get_meta' ) ) return;
			$session = WC()->session ?? null;
			if ( ! $session ) return;
			$key = $session->get( CheckoutKey::SESSION_FIELD );
			if ( CheckoutKey::valid( $key ) && $key === $order->get_meta( CheckoutKey::ORDER_META, true ) ) {
				$session->set( CheckoutKey::SESSION_FIELD, null );
				$session->set( self::LAST_CAPTURE, null );
			}
		} catch ( \Throwable $error ) {
			self::log( 'order_key_cleanup_unavailable', $error );
		}
	}

	public function capture(): void {
		try {
			$commerce = WC();
			$session = $commerce->session ?? null;
			if ( ! $session ) return;
			$snapshot = CheckoutSnapshot::fromCart( $commerce->cart ?? null, $commerce->customer ?? null );
			if ( null === $snapshot ) {
				self::log( 'snapshot_unavailable' );
				return;
			}
			$previous = $session->get( self::LAST_CAPTURE );
			$is_empty = isset( $snapshot['items'] ) && array() === $snapshot['items'];
			if ( $is_empty ) {
				// No key generation and no empty event for a never-observed checkout.
				// Bind the observation to this exact checkout, not just its WC session.
				$key = $session->get( CheckoutKey::SESSION_FIELD );
				if ( ! CheckoutKey::valid( $key ) || ! is_array( $previous ) ||
					( $previous['checkoutKey'] ?? null ) !== $key || ( $previous['empty'] ?? false ) ) return;
			} else {
				$key = CheckoutKey::current();
				if ( null === $key ) return;
				if ( $this->classicContact ) $snapshot['contact'] = array_merge( $snapshot['contact'] ?? array(), $this->classicContact );
			}
			$encoded = wp_json_encode( $snapshot );
			if ( ! is_string( $encoded ) ) {
				self::log( 'snapshot_encoding_failed' );
				return;
			}
			$fingerprint = hash( 'sha256', $encoded );
			if ( is_array( $previous ) && ( $previous['checkoutKey'] ?? null ) === $key &&
				( $previous['fingerprint'] ?? null ) === $fingerprint ) return;
			if ( $this->publisher->enqueue( $snapshot, $key ) ) {
				$session->set( self::LAST_CAPTURE, array(
					'checkoutKey' => $key, 'fingerprint' => $fingerprint, 'empty' => $is_empty,
				) );
			} else {
				self::log( 'enqueue_failed' );
			}
		} catch ( \Throwable $error ) {
			self::log( 'capture_unexpected', $error );
		}
	}

	private static function log( string $reason, ?\Throwable $error = null ): void {
		CheckoutDiagnosticLogger::record( 'checkout_capture', $reason, $error );
	}
}
