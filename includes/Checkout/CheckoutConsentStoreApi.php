<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/**
 * Blocks checkout consent through WooCommerce's authenticated Cart Store API.
 * WooCommerce owns session/cart initialization and Store API nonce/Cart-Token
 * validation. Moda never initializes those globals or mutates cart contents.
 *
 * The update callback's return value is ignored by WooCommerce. A minimal,
 * request-local acknowledgement is exposed through the CartSchema extensions
 * response, not through a custom WordPress REST permission endpoint.
 */
final class CheckoutConsentStoreApi {
	public const NAMESPACE = 'moda-interact-consent';
	private array $result = array( 'requestId' => '', 'status' => 'idle', 'confirmed' => false, 'reason' => '' );

	public function __construct( private readonly CheckoutConsentCapture $capture ) {}

	public function register(): void {
		// Runtime may initialize after Woo has already fired this hook.
		if ( function_exists( 'did_action' ) && did_action( 'woocommerce_blocks_loaded' ) > 0 ) {
			$this->registerCallbacks();
		} else {
			add_action( 'woocommerce_blocks_loaded', array( $this, 'registerCallbacks' ) );
		}
	}

	public function registerCallbacks(): void {
		if ( ! function_exists( 'woocommerce_store_api_register_update_callback' ) ||
			! function_exists( 'woocommerce_store_api_register_endpoint_data' ) ||
			! class_exists( '\\Automattic\\WooCommerce\\StoreApi\\Schemas\\V1\\CartSchema' ) ) return;
		woocommerce_store_api_register_update_callback( array(
			'namespace' => self::NAMESPACE,
			'callback' => array( $this, 'update' ),
		) );
		woocommerce_store_api_register_endpoint_data( array(
			'endpoint' => \Automattic\WooCommerce\StoreApi\Schemas\V1\CartSchema::IDENTIFIER,
			'namespace' => self::NAMESPACE,
			'data_callback' => array( $this, 'data' ),
			'schema_callback' => array( $this, 'schema' ),
			'schema_type' => ARRAY_A,
		) );
	}

	/** Strictly bounded metadata; no phone, grant-event ID or proof in a cart response. */
	public function data(): array {
		return $this->result;
	}

	public function schema(): array {
		return array( 'properties' => array(
			'requestId' => array( 'type' => 'string', 'readonly' => true ),
			'status' => array( 'type' => 'string', 'readonly' => true ),
			'confirmed' => array( 'type' => 'boolean', 'readonly' => true ),
			'reason' => array( 'type' => 'string', 'readonly' => true ),
		) );
	}

	/**
	 * Invoked only from POST /wc/store/v1/cart/extensions, after WooCommerce
	 * authenticates the shopper and has established the cart/session context.
	 * Expected phone is a non-authoritative equality guard against stale billing
	 * state; the only phone used for consent comes from WC()->customer.
	 */
	public function update( mixed $data ): void {
		try {
			$this->updateSafe( $data );
		} catch ( \Throwable $error ) {
			CheckoutConsentDiagnostics::warn( 'blocks_consent_request_failed', $error );
			$this->result = array( 'requestId' => '', 'status' => 'unverified',
				'confirmed' => false, 'reason' => 'capture_observe_unclassified' );
		}
	}

	private function updateSafe( mixed $data ): void {
		$this->result = array( 'requestId' => '', 'status' => 'unverified',
			'confirmed' => false, 'reason' => 'store_api_request_id_invalid' );
		if ( ! is_array( $data ) || ! isset( $data['requestId'] ) ||
			! is_string( $data['requestId'] ) ||
			! preg_match( '/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/D', $data['requestId'] ) ) return;
		$this->result['requestId'] = $data['requestId'];
		$this->result['reason'] = 'store_api_action_invalid';
		$action = $data['action'] ?? null;
		if ( ! in_array( $action, array( 'status', 'choice', 'withdraw' ), true ) ) return;
		$expected = $data['expectedPhone'] ?? null;
		$country = $data['expectedCountry'] ?? null;
		$this->result['reason'] = 'store_api_expected_phone_invalid';
		if ( ! is_string( $expected ) || strlen( $expected ) > 64 ) return;
		$this->result['reason'] = 'store_api_expected_country_invalid';
		if ( ! is_string( $country ) || ! preg_match( '/^[A-Z]{2}$/D', $country ) ) return;
		$canonical = CheckoutConsentPhone::normalize( $expected, $country );
		if ( null === $canonical ) {
			$this->result['reason'] = 'store_api_expected_phone_unparseable';
			return;
		}

		$woo = function_exists( 'WC' ) ? WC() : null;
		$session = $woo->session ?? null;
		$customer = $woo->customer ?? null;
		if ( ! is_object( $session ) || ! method_exists( $session, 'get_customer_id' ) ||
			'' === (string) $session->get_customer_id() ) {
			$this->result['reason'] = 'store_api_session_unavailable';
			return;
		}
		if ( ! is_object( $customer ) || ! method_exists( $customer, 'get_billing_phone' ) ||
			! method_exists( $customer, 'get_billing_country' ) ) {
			$this->result['reason'] = 'store_api_customer_unavailable';
			return;
		}
		$phone = $customer->get_billing_phone();
		$serverCountry = CheckoutConsentPhone::verifiedCountry( $customer->get_billing_country() );
		$serverCanonical = is_string( $phone ) ? CheckoutConsentPhone::normalize( $phone, $serverCountry ) : null;
		if ( null === $serverCanonical ) {
			$this->result['reason'] = 'store_api_server_phone_invalid';
			return;
		}
		if ( ! hash_equals( $canonical, $serverCanonical ) ) {
			$this->result['reason'] = 'store_api_billing_phone_mismatch';
			return;
		}

		if ( 'status' === $action ) {
			// Only a server-held, shopper-bound proof and live API-006 decision can
			// result in confirmed=true. A phone match cannot identify a shopper.
			$this->result['status'] = 'checked';
			$verification = $this->capture->permissionStatus( $phone, $serverCountry );
			$this->result['confirmed'] = $verification['confirmed'];
			$this->result['reason'] = $verification['reason'];
			return;
		}
		if ( 'choice' === $action ) {
			// The checkbox can create only a deliberate GRANT. Unchecking,
			// hydration and ordinary checkout refreshes never revoke consent.
			if ( ( $data['checked'] ?? null ) !== true ) {
				$this->result['reason'] = 'store_api_choice_value_invalid';
				return;
			}
			$recorded = $this->capture->observe( 'BLOCKS', true, $phone, $serverCountry,
				true, false, $data['requestId'] );
		} else {
			// Deliberate checkbox uncheck, independently proof-backed
			// and revalidated by capture at the time of withdrawal.
			if ( ( $data['confirmed'] ?? null ) !== true ) {
				$this->result['reason'] = 'store_api_withdraw_confirmation_missing';
				return;
			}
			$recorded = $this->capture->withdrawExplicit( 'BLOCKS', $phone, $serverCountry,
				true, $data['requestId'] );
		}
		if ( $recorded ) {
			$this->result['status'] = 'recorded';
			$this->result['reason'] = '';
		} else {
			$this->result['reason'] = $this->capture->failureReason();
		}

	}
}
