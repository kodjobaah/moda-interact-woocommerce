<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Checkout-local, nonce/session-protected explicit withdrawal command. */
final class CheckoutConsentActions {
	public function __construct( private readonly CheckoutConsentCapture $capture ) {}

	/**
	 * Classic checkout actions run inside Woo's native wc-ajax lifecycle.
	 * A standalone WordPress REST route does not restore WC()->session for
	 * anonymous shoppers even when their checkout session cookie is present.
	 * Blocks use the separate authenticated Store API cart/extensions contract.
	 */
	public function register(): void {
		add_action( 'wc_ajax_moda_interact_checkout_consent_status', array( $this, 'ajaxStatus' ) );
		add_action( 'wc_ajax_moda_interact_checkout_consent_withdraw', array( $this, 'ajaxWithdraw' ) );
	}

	/** The AJAX transport cannot choose a shopper, contact or nonce for itself. */
	private function classicAjaxRequest(): object {
		$security = $_POST['security'] ?? null;
		$payload = array(
			// These actions are Classic-only: a posted BLOCKS mode must not
			// reach the Cart Store API's independently protected path.
			'mode' => ( $_POST['mode'] ?? null ) === 'CLASSIC' ? 'CLASSIC' : null,
			'form' => $_POST['form'] ?? null,
			'confirmed' => ( $_POST['confirmed'] ?? null ) === '1',
		);
		$method = $_SERVER['REQUEST_METHOD'] ?? '';
		return new class( $security, $payload, $method ) {
			public function __construct( private mixed $security, private array $payload,
				private mixed $method ) {}
			public function get_header( mixed $name ): ?string {
				return is_string( $name ) && strtolower( $name ) === 'x-wp-nonce' &&
					is_string( $this->security ) ? $this->security : null;
			}
			public function get_method(): string {
				return is_string( $this->method ) ? $this->method : '';
			}
			public function get_json_params(): array { return $this->payload; }
		};
	}

	public function ajaxStatus(): void {
		try {
			$request = $this->classicAjaxRequest();
			$permitted = $this->permitted( $request );
			wp_send_json( $this->status( $request ), $permitted ? 200 : 403 );
		} catch ( \Throwable $error ) {
			CheckoutConsentDiagnostics::warn( 'classic_status_request_failed', $error );
			wp_send_json( array( 'confirmed' => false,
				'reason' => 'consent_status_remote_unavailable' ), 200 );
		}
	}

	public function ajaxWithdraw(): void {
		try {
			$request = $this->classicAjaxRequest();
			$permitted = $this->permitted( $request );
			wp_send_json( $this->withdraw( $request ), $permitted ? 200 : 403 );
		} catch ( \Throwable $error ) {
			CheckoutConsentDiagnostics::warn( 'classic_withdraw_request_failed', $error );
			wp_send_json( array( 'status' => 'unverified' ), 200 );
		}
	}

	public function permitted( mixed $request ): bool {
		if ( ! is_object( $request ) || ! method_exists( $request, 'get_header' ) ||
			! method_exists( $request, 'get_method' ) || 'POST' !== strtoupper( (string) $request->get_method() ) ||
			! function_exists( 'wp_verify_nonce' ) ) return false;
		$nonce = $request->get_header( 'X-WP-Nonce' );
		if ( ! is_string( $nonce ) || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) return false;
		// Native wc-ajax has already established Woo's checkout objects. Do NOT
		// initialise a missing session/cart here or accept an arbitrary phone
		// as a substitute for the current shopper's signed cookie and proof.
		$woo = function_exists( 'WC' ) ? WC() : null;
		$session = $woo->session ?? null;
		return is_object( $session ) && method_exists( $session, 'get_customer_id' ) &&
			'' !== (string) $session->get_customer_id();
	}

	/** Legacy non-routed Blocks helper: Cart Store API owns live Blocks actions. */
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
			( $payload['mode'] ?? null ) !== 'BLOCKS' || ( $payload['checked'] ?? null ) !== true ) {
			return $this->choiceRejected( 'invalid_choice' );
		}
		$contact = $this->contact( $payload );
		if ( null === $contact ) return $this->choiceRejected( 'billing_contact_unavailable' );
		$changed = $this->capture->observe( 'BLOCKS', $payload['checked'],
			$contact['phone'], $contact['country'], true, false );
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
		// Never rely solely on the Woo AJAX dispatcher when unit-tested.
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
