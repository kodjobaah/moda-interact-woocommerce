<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/**
 * Checkout-origin server observation. Neither a phone lookup nor a checkbox
 * rendered in a browser is consent. Hooks only run after Woo security checks;
 * this class independently validates their nonce/session and observes a change.
 */
final class CheckoutConsentCapture {
	private const SESSION_FIELD = 'moda_interact_checkout_consent_observation_v1';
	private const BLOCKS_STAGE = 'moda_interact_checkout_blocks_waiting_for_phone_v1';

	public function __construct(
		private readonly CheckoutConsentPublisher $publisher,
		private readonly ?CheckoutConsentEligibility $eligibility = null
	) {}

	public function register(): void {
		$this->publisher->register();
		// Runs before capture's priority 10. Capture remains independent and
		// never infers consent from the checkout activity payload.
		add_action( 'woocommerce_checkout_update_order_review', array( $this, 'classicReview' ), 5, 1 );
		add_action( 'woocommerce_store_api_checkout_update_draft', array( $this, 'blocksDraft' ), 5, 1 );
		// An existing Woo draft order takes a different PUT path than a fresh session.
		add_action( 'woocommerce_store_api_checkout_update_order_from_request', array( $this, 'blocksOrderDraft' ), 5, 2 );
		add_action( 'woocommerce_store_api_checkout_update_customer_from_request', array( $this, 'blocksCustomer' ), 5, 2 );
		add_action( 'woocommerce_store_api_cart_update_customer_from_request', array( $this, 'blocksBillingUpdated' ), 5, 2 );
		add_action( 'woocommerce_checkout_order_processed', array( $this, 'endCheckout' ), 20, 1 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( $this, 'endCheckout' ), 20, 1 );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueueClassicChange' ) );
	}

	public function enqueueClassicChange(): void {
		if ( ! function_exists( 'is_checkout' ) || ! is_checkout() ||
			( function_exists( 'is_order_received_page' ) && is_order_received_page() ) ) return;
		// Only a classic checkout uses this script; Blocks uses the official PUT draft hook.
		if ( function_exists( 'has_block' ) && has_block( 'woocommerce/checkout' ) ) return;
		if ( ! ( $this->eligibility ?? new CheckoutConsentEligibility() )->eligible() ) return;
		wp_enqueue_script( 'moda-woo-consent-classic',
			plugins_url( 'assets/js/checkout-consent-classic.js', MODA_INTERACT_MAIN_PLUGIN_FILE ),
			array( 'jquery' ), '1.0.0', true );
	}

	public function classicReview( mixed $posted ): void {
		// Woo's update_order_review action fires after check_ajax_referer; reject
		// direct hook calls and forged requests instead of trusting an assertion.
		$nonce = $_POST['security'] ?? null;
		if ( ! is_string( $nonce ) || ! function_exists( 'wp_verify_nonce' ) ||
			! wp_verify_nonce( $nonce, 'update-order-review' ) ) return;
		if ( ! is_string( $posted ) || strlen( $posted ) > 8192 ) return;
		parse_str( $posted, $fields );
		if ( ! is_array( $fields ) || ! isset( $fields['billing_phone'] ) ||
			! is_string( $fields['billing_phone'] ) ) return;
		$selection = array_key_exists( CheckoutConsentCheckbox::CLASSIC_FIELD, $fields );
		$this->observe( 'CLASSIC', $selection, $fields['billing_phone'],
			CheckoutConsentPhone::verifiedCountry( $fields['billing_country'] ?? null ), true );
	}

	public function blocksDraft( mixed $request ): void {
		$this->blocksFromRequest( $request );
	}

	/** Woo's PUT path with an existing (e.g. failed-payment) draft order. */
	public function blocksOrderDraft( mixed $order, mixed $request ): void {
		$this->blocksFromRequest( $request );
	}

	/** Some Store API versions observe the billing-contact update separately. */
	public function blocksCustomer( mixed $customer, mixed $request ): void {
		$this->blocksFromRequest( $request );
	}

	/** Woo's authenticated Store API billing-address update may follow field PUT. */
	public function blocksBillingUpdated( mixed $customer, mixed $request ): void {
		if ( ! is_object( $request ) || ! method_exists( $request, 'get_header' ) ||
			! method_exists( $request, 'get_method' ) || strtoupper( (string ) $request->get_method() ) !== 'POST' ||
			! $this->verifiedStoreApiRequest( $request ) ) return;
		$session = WC()->session ?? null;
		if ( ! $session ) return;
		$stage = $session->get( self::BLOCKS_STAGE );
		if ( ! is_array( $stage ) || ( $stage['checkoutKey'] ?? null ) !== CheckoutKey::current() ||
			( $stage['principal'] ?? null ) !== $this->currentPrincipal() ||
			! is_int( $stage['observedAt'] ?? null ) || time() - $stage['observedAt'] > 240 ) return;
		$this->observeBlocksCustomer( true, $customer );
	}

	private function currentPrincipal(): ?string {
		$session = WC()->session ?? null;
		if ( ! $session || ! method_exists( $session, 'get_customer_id' ) ) return null;
		$id = (string) $session->get_customer_id();
		return '' === $id ? null : hash( 'sha256', $id . '|' .
			( function_exists( 'get_current_user_id' ) ? (int) get_current_user_id() : 0 ) );
	}

	private function observeBlocksCustomer( bool $checked, mixed $customer ): void {
		if ( ! is_object( $customer ) || ! method_exists( $customer, 'get_billing_phone' ) ) return;
		$phone = $customer->get_billing_phone();
		$country = method_exists( $customer, 'get_billing_country' ) ? $customer->get_billing_country() : null;
		$verified = CheckoutConsentPhone::verifiedCountry( $country );
		if ( ! is_string( $phone ) || null === CheckoutConsentPhone::normalize( $phone, $verified ) ) return;
		$this->observe( 'BLOCKS', $checked, $phone, $verified, true );
		$session = WC()->session ?? null;
		if ( $session ) $session->set( self::BLOCKS_STAGE, null );
	}

	private function blocksFromRequest( mixed $request ): void {
		if ( ! is_object( $request ) || ! method_exists( $request, 'get_header' ) ||
			! method_exists( $request, 'get_json_params' ) || ! method_exists( $request, 'get_method' ) ||
			! in_array( strtoupper( (string) $request->get_method() ), array( 'PUT', 'PATCH' ), true ) ||
			! $this->verifiedStoreApiRequest( $request ) ) return;
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || ! isset( $payload['additional_fields'] ) ||
			! is_array( $payload['additional_fields'] ) ||
			! array_key_exists( CheckoutConsentCheckbox::BLOCK_FIELD, $payload['additional_fields'] ) ) return;
		$selected = $payload['additional_fields'][ CheckoutConsentCheckbox::BLOCK_FIELD ];
		if ( ! in_array( $selected, array( true, false, '1', '0', 'true', 'false', 1, 0 ), true ) ) return;
		// The checkbox PUT may arrive before the server's billing phone. Stage
		// only the explicit selection in this WC session; no consent is recorded
		// until another authenticated Store API request supplies a valid phone.
		$session = WC()->session ?? null;
		if ( ! $session ) return;
		$checked = in_array( $selected, array( true, '1', 'true', 1 ), true );
		if ( $checked && null !== CheckoutKey::current() && null !== $this->currentPrincipal() ) {
			$session->set( self::BLOCKS_STAGE, array(
				'checkoutKey' => CheckoutKey::current(), 'principal' => $this->currentPrincipal(),
				'observedAt' => time(),
			) );
		} else {
			$session->set( self::BLOCKS_STAGE, null );
		}
		$this->observeBlocksCustomer( $checked, WC()->customer ?? null );
	}

	private function verifiedStoreApiRequest( object $request ): bool {
		$nonce = $request->get_header( 'Nonce' );
		if ( is_string( $nonce ) && '' !== $nonce && function_exists( 'wp_verify_nonce' ) &&
			wp_verify_nonce( $nonce, 'wc_store_api' ) ) return true;
		// Woo Store API supports Cart-Token without a Nonce. Only accept a token
		// that Woo has resolved to the CURRENT WC session (never an arbitrary JWT).
		$token = $request->get_header( 'Cart-Token' );
		$class = '\\Automattic\\WooCommerce\\StoreApi\\Utilities\\CartTokenUtils';
		$session = WC()->session ?? null;
		if ( ! is_string( $token ) || '' === $token || ! $session || ! method_exists( $session, 'get_customer_id' ) ||
			! class_exists( $class ) || ! method_exists( $class, 'validate_cart_token' ) ||
			! method_exists( $class, 'get_cart_token' ) ) return false;
		try {
			$expected = $class::get_cart_token( (string) $session->get_customer_id() );
			return is_string( $expected ) && hash_equals( $expected, $token ) && $class::validate_cart_token( $token );
		} catch ( \Throwable $error ) { return false; }
	}

	/** Session observation, transition deduplication and monotonic event identity. */
	public function observe( string $mode, bool $checked, mixed $phone, ?string $country, bool $verified ): bool {
		if ( ! $verified || ! in_array( $mode, array( 'CLASSIC', 'BLOCKS' ), true ) ) return false;
		$woo = function_exists( 'WC' ) ? WC() : null;
		$session = $woo->session ?? null;
		$cart = $woo->cart ?? null;
		if ( ! $session || ! is_object( $cart ) || ! method_exists( $cart, 'get_cart' ) ||
			! is_array( $cart->get_cart() ) || count( $cart->get_cart() ) === 0 ) return false;
		$key = CheckoutKey::current();
		if ( null === $key || ! is_string( $phone ) ) return false;
		$canonical = CheckoutConsentPhone::normalize( $phone, $country );
		if ( null === $canonical ) return false;
		$user_id = function_exists( 'get_current_user_id' ) ? (int) get_current_user_id() : 0;
		$session_id = method_exists( $session, 'get_customer_id' ) ? (string) $session->get_customer_id() : '';
		if ( '' === $session_id ) return false;
		$state = $session->get( self::SESSION_FIELD );
		$prior_identity = is_array( $state ) && isset( $state['principal'] ) && isset( $state['checkoutKey'] );
		$principal = hash( 'sha256', $session_id . '|' . $user_id );
		if ( ! is_array( $state ) || ( $state['checkoutKey'] ?? null ) !== $key ||
			( $state['principal'] ?? null ) !== $principal ) {
			// A changed login/guest session must not inherit another user's checkbox.
			$state = array( 'checkoutKey' => $key, 'principal' => $principal,
				'canonicalPhone' => $canonical, 'checked' => false, 'observedAt' => null, 'pending' => null );
			$session->set( self::SESSION_FIELD, $state );
			// For a new session, accept a deliberate checked request from the
			// initially unchecked control only if no previous session identity existed.
			if ( $checked && $prior_identity ) return false;
		}
		if ( $state['canonicalPhone'] !== $canonical ) {
			// A changed phone is never covered by an older grant: require a new
			// unchecked -> checked transition on the newly observed recipient.
			$state['canonicalPhone'] = $canonical;
			$state['checked'] = false;
			$state['pending'] = null;
			$session->set( self::SESSION_FIELD, $state );
			return false;
		}
		if ( $checked === $state['checked'] ) {
			// Lost-ACK replay: retry exactly the same event/ID/body, never a new GRANT.
			if ( is_array( $state['pending'] ) ) {
				if ( $this->publisher->publish( $state['pending'], false ) ) {
					$state['pending'] = null;
					$session->set( self::SESSION_FIELD, $state );
					return true;
				}
			}
			return false;
		}
		if ( $checked && ! ( $this->eligibility ?? new CheckoutConsentEligibility() )->eligible() ) return false;
		// Never construct a positive event from an unchecked default or a phone match.
		$observed_at = $this->timestamp( $state['observedAt'] ?? null );
		if ( null === $observed_at ) return false;
		$disclosure = null;
		if ( $checked ) {
			$ui = CheckoutConsentCheckbox::disclosure();
			$installation = ( new \ModaInteract\WooCommerce\Connection\InstallationStore() )->read();
			if ( 'valid' !== $installation['state'] ) return false;
			$disclosure = array( 'version' => $ui['version'], 'locale' => $ui['locale'],
				'text' => $ui['text'], 'merchantSiteUrl' => $installation['record']['canonicalSiteUrl'] );
			if ( ! str_contains( $ui['text'], $disclosure['merchantSiteUrl'] ) ) return false;
		}
		$event = array(
			'schemaVersion' => 'woo.whatsapp-consent.v1',
			'eventId' => 'woo-consent-' . bin2hex( random_bytes( 16 ) ),
			'decision' => $checked ? 'GRANT' : 'REVOKE',
			'purpose' => 'WHATSAPP_CHECKOUT_RECOVERY',
			'canonicalPhone' => $canonical,
			'checkoutAction' => array(
				'checkoutKey' => $key, 'checkoutMode' => $mode,
				'source' => 'WOO_CHECKOUT_SERVER_HOOK',
				'fieldId' => 'moda/whatsapp-checkout-recovery',
				'selection' => $checked ? 'CHECKED' : 'UNCHECKED',
				'userInitiated' => true, 'nonceVerified' => true, 'sessionVerified' => true,
				'serverObservedPhone' => $phone, 'verifiedCountryCode' => $country,
				'occurredAt' => $observed_at,
			),
			'disclosure' => $disclosure,
		);
		$state['checked'] = $checked;
		$state['observedAt'] = $observed_at;
		$state['pending'] = $event;
		$session->set( self::SESSION_FIELD, $state );
		if ( $this->publisher->publish( $event ) ) {
			$state['pending'] = null;
			$session->set( self::SESSION_FIELD, $state );
			return true;
		}
		return false;
	}

	private function timestamp( mixed $previous ): ?string {
		for ( $i = 0; $i < 4; $i++ ) {
			$now = gmdate( 'Y-m-d\TH:i:s', time() ) . sprintf( '.%03dZ', ( (int) floor( microtime( true ) * 1000 ) ) % 1000 );
			if ( ! is_string( $previous ) || strcmp( $now, $previous ) > 0 ) return $now;
			usleep( 3000 );
		}
		return null;
	}

	public function endCheckout(): void {
		$session = function_exists( 'WC' ) ? ( WC()->session ?? null ) : null;
		if ( $session ) {
			$session->set( self::SESSION_FIELD, null );
			$session->set( self::BLOCKS_STAGE, null );
		}
	}
}
