<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Supported Classic and Store API / Checkout Blocks checkout hooks. */
final class CheckoutCapture {
	private const LAST_CAPTURE = 'moda_interact_checkout_last_capture_v1';
	private const ENGAGEMENT_VISIT_TTL = 1800;
	private const ENGAGEMENT_ROUTE = '/checkout-engagement';
	private array $classicContact = array();

	public function __construct( private readonly CheckoutActivityPublisher $publisher ) {}

	public function register(): void {
		$this->publisher->register();
		add_action( 'rest_api_init', array( $this, 'registerEngagementRoute' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueueEngagementScript' ) );
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

	/** Register the one-time, Woo-session-bound human-return signal. */
	public function registerEngagementRoute(): void {
		register_rest_route( 'moda-interact/v1', self::ENGAGEMENT_ROUTE, array(
			'methods' => 'POST',
			'callback' => array( $this, 'recordEngagement' ),
			'permission_callback' => '__return_true',
		) );
	}

	/** Issue a short-lived nonce only to a non-empty cart/checkout page with an existing checkout identity. */
	public function enqueueEngagementScript(): void {
		try {
			$on_cart = function_exists( 'is_cart' ) && is_cart();
			$on_checkout = function_exists( 'is_checkout' ) && is_checkout();
			if ( ( function_exists( 'is_admin' ) && is_admin() ) || ( ! $on_cart && ! $on_checkout ) ||
				( function_exists( 'is_order_received_page' ) && is_order_received_page() ) ||
				( function_exists( 'is_checkout_pay_page' ) && is_checkout_pay_page() ) ) return;
			$commerce = function_exists( 'WC' ) ? WC() : null;
			$session = $commerce->session ?? null;
			$cart = $commerce->cart ?? null;
			if ( ! $session || ! CheckoutKey::valid( $session->get( CheckoutKey::SESSION_FIELD ) ) ||
				! is_object( $cart ) || ! method_exists( $cart, 'get_cart' ) ||
				! is_array( $cart->get_cart() ) || array() === $cart->get_cart() ) return;
			$key = $session->get( CheckoutKey::SESSION_FIELD );
			$nonce = $this->issueEngagementNonce( $session, $key );
			if ( null === $nonce ) return;
			$handle = 'moda-woo-checkout-engagement';
			wp_enqueue_script( $handle,
				plugins_url( 'assets/js/checkout-engagement.js', MODA_INTERACT_MAIN_PLUGIN_FILE ),
				array(), '1.0.0', true );
			$config = array(
				'url' => rest_url( 'moda-interact/v1/checkout-engagement' ),
				'nonce' => $nonce,
				'wpNonce' => wp_create_nonce( 'wp_rest' ),
			);
			wp_add_inline_script( $handle, 'window.ModaWooCheckoutEngagement = ' . wp_json_encode( $config ) . ';', 'before' );
		} catch ( \Throwable $error ) {
			self::log( 'engagement_script_unavailable', $error );
		}
	}

	/** The nonce is stored in the active WC session and consumed by one POST only. */
	private function issueEngagementNonce( object $session, mixed $checkout_key ): ?string {
		try {
			$session_binding = self::sessionBinding( $session );
			if ( ! CheckoutKey::valid( $checkout_key ) || '' === $session_binding ) return null;
			$nonce = bin2hex( random_bytes( 32 ) );
			$issued = set_transient( self::engagementNonceTransientKey( $nonce ), array(
				'bindingMode' => self::sessionBindingMode(),
				'sessionBinding' => $session_binding,
				'checkoutKey' => $checkout_key,
				'expiresAt' => time() + self::ENGAGEMENT_VISIT_TTL,
			), self::ENGAGEMENT_VISIT_TTL );
			if ( ! $issued ) return null;
			return $nonce;
		} catch ( \Throwable $error ) {
			self::log( 'engagement_nonce_unavailable', $error );
			return null;
		}
	}

	/** Accept only a same-origin, exact-shape POST for a nonce issued to this WC session. */
	public function recordEngagement( \WP_REST_Request $request ): \WP_REST_Response {
		if ( 'POST' !== strtoupper( $request->get_method() ) ||
			! self::sameOriginRequest( $request ) ||
			! self::validEngagementRequest( $request ) ) return self::engagementResponse( 'INVALID_REQUEST', 400 );
		try {
			// Custom REST routes do not necessarily pass through Woo's storefront
			// cart bootstrap. Load the current cookie-bound session before reading
			// the one-time visit token or checkout identity.
			if ( function_exists( 'wc_load_cart' ) ) wc_load_cart();
			$commerce = function_exists( 'WC' ) ? WC() : null;
			$session = $commerce->session ?? null;
			$input = $request->get_json_params();
			$nonce = is_array( $input ) ? ( $input['nonce'] ?? null ) : null;
			if ( ! $session ) {
				self::log( 'engagement_session_unavailable' );
				return self::engagementResponse( 'SESSION_UNAVAILABLE', 403 );
			}
			if ( ! is_string( $nonce ) || 64 !== strlen( $nonce ) ||
				1 !== preg_match( '/^[a-f0-9]{64}$/D', $nonce ) ) {
				self::log( 'engagement_nonce_invalid' );
				return self::engagementResponse( 'SESSION_UNAVAILABLE', 403 );
			}
			$key = $session->get( CheckoutKey::SESSION_FIELD );
			$issued = get_transient( self::engagementNonceTransientKey( $nonce ) );
			delete_transient( self::engagementNonceTransientKey( $nonce ) );
			$session_binding = self::sessionBinding( $session );
			if ( ! is_array( $issued ) ) {
				self::log( 'engagement_nonce_missing' );
				return self::engagementResponse( 'INVALID_NONCE', 403 );
			}
			if ( ! is_int( $issued['expiresAt'] ?? null ) || $issued['expiresAt'] < time() ) {
				self::log( 'engagement_nonce_expired' );
				return self::engagementResponse( 'INVALID_NONCE', 403 );
			}
			if ( '' === $session_binding || ! is_string( $issued['sessionBinding'] ?? null ) ||
				! hash_equals( $issued['sessionBinding'], $session_binding ) ) {
				$issued_mode = in_array( $issued['bindingMode'] ?? null, array( 'user', 'woo', 'none' ), true ) ? $issued['bindingMode'] : 'unknown';
				self::log( 'engagement_nonce_session_mismatch_' . $issued_mode . '_' . self::sessionBindingMode() );
				return self::engagementResponse( 'INVALID_NONCE', 403 );
			}
			if ( ! CheckoutKey::valid( $key ) || ! is_string( $issued['checkoutKey'] ?? null ) ||
				! hash_equals( $issued['checkoutKey'], $key ) ) {
				self::log( 'engagement_nonce_invalid' );
				return self::engagementResponse( 'INVALID_NONCE', 403 );
			}
			$cart = $commerce->cart ?? null;
			if ( ! CheckoutKey::valid( $key ) || ! is_object( $cart ) || ! method_exists( $cart, 'get_cart' ) ||
				! is_array( $cart->get_cart() ) || array() === $cart->get_cart() ) {
				return self::engagementResponse( 'CHECKOUT_UNAVAILABLE', 409 );
			}
			if ( ! $this->captureSnapshot( true ) ) {
				self::log( 'engagement_capture_failed' );
				return self::engagementResponse( 'CAPTURE_UNAVAILABLE', 503 );
			}
			return self::engagementResponse( 'accepted', 202 );
		} catch ( \Throwable $error ) {
			self::log( 'engagement_unexpected', $error );
			return self::engagementResponse( 'CAPTURE_UNAVAILABLE', 503 );
		}
	}

	private static function validEngagementRequest( \WP_REST_Request $request ): bool {
		$input = $request->get_json_params();
		return is_array( $input ) && 1 === count( $input ) &&
			isset( $input['nonce'] ) && is_string( $input['nonce'] ) &&
			array() === $request->get_query_params() && array() === $request->get_body_params() &&
			array() === $request->get_file_params() && strlen( $request->get_body() ) <= 256 &&
			1 === preg_match( '#^application/json(?:\\s*;\\s*charset=utf-8)?$#iD', (string) $request->get_header( 'Content-Type' ) );
	}

	private static function sameOriginRequest( \WP_REST_Request $request ): bool {
		$origin = $request->get_header( 'Origin' );
		if ( is_string( $origin ) && '' !== $origin ) {
			$received = parse_url( $origin );
			if ( ! is_array( $received ) || isset( $received['path'] ) || isset( $received['query'] ) || isset( $received['fragment'] ) ) return false;
		} else {
			$referer = $request->get_header( 'Referer' );
			$received = is_string( $referer ) ? parse_url( $referer ) : false;
		}
		$site = parse_url( home_url( '/' ) );
		if ( ! is_array( $received ) || ! is_array( $site ) || ! isset( $received['scheme'], $received['host'], $site['scheme'], $site['host'] ) ) return false;
		$received_origin = strtolower( $received['scheme'] . '://' . $received['host'] . ( isset( $received['port'] ) ? ':' . $received['port'] : '' ) );
		$expected_origin = strtolower( $site['scheme'] . '://' . $site['host'] . ( isset( $site['port'] ) ? ':' . $site['port'] : '' ) );
		return hash_equals( $expected_origin, $received_origin );
	}

	private static function engagementResponse( string $status, int $http_status ): \WP_REST_Response {
		$response = new \WP_REST_Response( array( 'status' => $status ), $http_status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Referrer-Policy', 'no-referrer' );
		return $response;
	}

	private static function sessionBinding( object $session ): string {
		$user_id = function_exists( 'get_current_user_id' ) ? (int) get_current_user_id() : 0;
		$session_token = function_exists( 'wp_get_session_token' ) ? (string) wp_get_session_token() : '';
		if ( $user_id > 0 && '' !== $session_token ) {
			return 'user:' . hash( 'sha256', $user_id . ':' . $session_token );
		}
		if ( ! method_exists( $session, 'get_customer_id' ) ) return '';
		$customer_id = (string) $session->get_customer_id();
		return '' === $customer_id ? '' : 'woo:' . hash( 'sha256', $customer_id );
	}

	private static function sessionBindingMode(): string {
		$user_id = function_exists( 'get_current_user_id' ) ? (int) get_current_user_id() : 0;
		$session_token = function_exists( 'wp_get_session_token' ) ? (string) wp_get_session_token() : '';
		if ( $user_id > 0 && '' !== $session_token ) return 'user';
		return 'woo';
	}

	private static function engagementNonceTransientKey( string $nonce ): string {
		return 'moda_woo_engagement_' . hash( 'sha256', $nonce );
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
		$this->captureSnapshot( false );
	}

	/** Publish a fresh event only after a nonce-verified real customer interaction. */
	private function captureSnapshot( bool $force ): bool {
		try {
			$commerce = WC();
			$session = $commerce->session ?? null;
			if ( ! $session ) return false;
			$snapshot = CheckoutSnapshot::fromCart( $commerce->cart ?? null, $commerce->customer ?? null );
			if ( null === $snapshot ) {
				self::log( 'snapshot_unavailable' );
				return false;
			}
			$previous = $session->get( self::LAST_CAPTURE );
			$is_empty = isset( $snapshot['items'] ) && array() === $snapshot['items'];
			if ( $force && $is_empty ) return false;
			if ( $is_empty ) {
				// No key generation and no empty event for a never-observed checkout.
				// Bind the observation to this exact checkout, not just its WC session.
				$key = $session->get( CheckoutKey::SESSION_FIELD );
				if ( ! CheckoutKey::valid( $key ) || ! is_array( $previous ) ||
					( $previous['checkoutKey'] ?? null ) !== $key || ( $previous['empty'] ?? false ) ) return false;
			} else {
				$key = $force ? $session->get( CheckoutKey::SESSION_FIELD ) : CheckoutKey::current();
				if ( ! CheckoutKey::valid( $key ) ) return false;
				if ( $this->classicContact ) $snapshot['contact'] = array_merge( $snapshot['contact'] ?? array(), $this->classicContact );
			}
			$encoded = wp_json_encode( $snapshot );
			if ( ! is_string( $encoded ) ) {
				self::log( 'snapshot_encoding_failed' );
				return false;
			}
			$fingerprint = hash( 'sha256', $encoded );
			if ( ! $force && is_array( $previous ) && ( $previous['checkoutKey'] ?? null ) === $key &&
				( $previous['fingerprint'] ?? null ) === $fingerprint ) return false;
			if ( $this->publisher->enqueue( $snapshot, $key ) ) {
				$session->set( self::LAST_CAPTURE, array(
					'checkoutKey' => $key, 'fingerprint' => $fingerprint, 'empty' => $is_empty,
				) );
				return true;
			} else {
				self::log( 'enqueue_failed' );
				return false;
			}
		} catch ( \Throwable $error ) {
			self::log( 'capture_unexpected', $error );
			return false;
		}
	}

	private static function log( string $reason, ?\Throwable $error = null ): void {
		CheckoutDiagnosticLogger::record( 'checkout_capture', $reason, $error );
	}
}
