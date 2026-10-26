<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Checkout-local, nonce/session-protected explicit withdrawal command. */
final class CheckoutConsentActions {
	public function __construct( private readonly CheckoutConsentCapture $capture ) {}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoute' ), 10, 0 );
	}

	public function registerRoute(): void {
		// Blocks choices use Woo's authenticated Store API cart/extensions flow.
		// Do not expose a second consent-choice boundary with separate sessions.
		register_rest_route( 'moda-interact/v1', '/checkout-consent/status', array(
			'methods' => 'POST',
			'permission_callback' => array( $this, 'permitted' ),
			'callback' => array( $this, 'status' ),
		) );
		register_rest_route( 'moda-interact/v1', '/checkout-consent/withdraw', array(
			'methods' => 'POST',
			'permission_callback' => array( $this, 'permitted' ),
			'callback' => array( $this, 'withdraw' ),
		) );
	}

	public function permitted( mixed $request ): bool {
		if ( ! is_object( $request ) || ! method_exists( $request, 'get_header' ) ||
			! method_exists( $request, 'get_method' ) || 'POST' !== strtoupper( (string) $request->get_method() ) ||
			! function_exists( 'wp_verify_nonce' ) ) return false;
		$nonce = $request->get_header( 'X-WP-Nonce' );
		if ( ! is_string( $nonce ) || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) return false;
		// A custom REST request may not have Woo's checkout objects loaded.
		// Do NOT call wc_load_cart() or initialize the session/cart/customer here:
		// this runs even for read-only consent-status requests on merchant sites.
		// If Woo has not established the current session, fail closed.
		$woo = function_exists( 'WC' ) ? WC() : null;
		$session = $woo->session ?? null;
		return is_object( $session ) && method_exists( $session, 'get_customer_id' ) &&
			'' !== (string) $session->get_customer_id();
	}

	/** Blocks SlotFill's deliberate checkbox action uses the current Woo billing contact. */
	public function choice( mixed $request ): array {
		if ( ! $this->permitted( $request ) || ! is_object( $request ) ||
			! method_exists( $request, 'get_json_params' ) || ! method_exists( $request, 'get_header' ) ) {
			return $this->choiceRejected( 'rest_context_unavailable' );
		}
		if ( ! function_exists( 'wp_verify_nonce' ) ||
			! wp_verify_nonce( (string) $request->get_header( 'X-WC-Store-API-Nonce' ), 'wc_store_api' ) ) {
			return $this->choiceRejected( 'store_nonce_invalid' );
		}
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || array_keys( $payload ) !== array( 'mode', 'checked' ) ||
			( $payload['mode'] ?? null ) !== 'BLOCKS' || ! is_bool( $payload['checked'] ) ) {
			return $this->choiceRejected( 'invalid_choice' );
		}
		$contact = $this->contact( $payload );
		if ( null === $contact ) return $this->choiceRejected( 'billing_contact_unavailable' );
		$changed = $this->capture->observe( 'BLOCKS', $payload['checked'],
			$contact['phone'], $contact['country'], true, ! $payload['checked'] );
		if ( $changed ) return array( 'status' => 'recorded' );
		return $this->choiceRejected( $this->capture->failureReason() );
	}

	/** Only short, fixed reason codes leave PHP. Never return checkout/phone data. */
	private function choiceRejected( string $reason ): array {
		return array( 'status' => 'unverified', 'reason' => $reason );
	}

	/** Return only current confirmation and a fixed diagnostic; never the stored proof. */
	public function status( mixed $request ): array {
		if ( ! $this->permitted( $request ) || ! method_exists( $request, 'get_json_params' ) ) {
			return array( 'confirmed' => false, 'reason' => 'consent_status_context_unavailable' );
		}
		$payload = $request->get_json_params();
		$contact = is_array( $payload ) ? $this->contact( $payload ) : null;
		if ( null === $contact ) return array( 'confirmed' => false,
			'reason' => 'consent_status_contact_unavailable' );
		return $this->capture->permissionStatus( $contact['phone'], $contact['country'] );
	}

	/** Contact originates from verified Woo checkout/session, not a status phone query. */
	private function contact( array $payload ): ?array {
		if ( ! isset( $payload['mode'] ) || ! in_array( $payload['mode'], array( 'CLASSIC', 'BLOCKS' ), true ) ) return null;
		$customer = WC()->customer ?? null;
		if ( 'BLOCKS' === $payload['mode'] ) {
			$phone = is_object( $customer ) && method_exists( $customer, 'get_billing_phone' )
				? $customer->get_billing_phone() : null;
			$country = is_object( $customer ) && method_exists( $customer, 'get_billing_country' )
				? CheckoutConsentPhone::verifiedCountry( $customer->get_billing_country() ) : null;
		} else {
			$posted = $payload['form'] ?? null;
			if ( ! is_string( $posted ) || strlen( $posted ) > 8192 ) return null;
			parse_str( $posted, $fields );
			if ( ! is_array( $fields ) || ! is_string( $fields['billing_phone'] ?? null ) ) return null;
			$phone = $fields['billing_phone'];
			$country = CheckoutConsentPhone::verifiedCountry( $fields['billing_country'] ?? null );
		}
		return is_string( $phone ) && null !== CheckoutConsentPhone::normalize( $phone, $country )
			? array( 'phone' => $phone, 'country' => $country ) : null;
	}

	public function withdraw( mixed $request ): array {
		// Never rely solely on REST callback permission dispatch when unit-tested.
		if ( ! $this->permitted( $request ) || ! method_exists( $request, 'get_json_params' ) ) {
			return array( 'status' => 'unverified' );
		}
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || ! isset( $payload['mode'] ) ||
			! in_array( $payload['mode'], array( 'CLASSIC', 'BLOCKS' ), true ) ||
			true !== ( $payload['confirmed'] ?? false ) ) {
			return array( 'status' => 'unverified' );
		}
		$contact = $this->contact( $payload );
		if ( null === $contact ) return array( 'status' => 'unverified' );

		if ( ! $this->capture->withdrawExplicit( $payload['mode'], $contact['phone'], $contact['country'], true ) ) {
			return array( 'status' => 'unverified' );
		}
		return array( 'status' => 'withdrawn' );
	}
}
