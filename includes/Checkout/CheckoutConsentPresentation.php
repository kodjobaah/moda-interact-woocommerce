<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Presentation only: the server-owned API-006 proof controls which view appears. */
final class CheckoutConsentPresentation {
	private $eligible;
	private ?bool $eligibilityForRequest = null;

	public function __construct( ?callable $eligible = null ) {
		$this->eligible = $eligible ?? static fn(): bool => ( new CheckoutConsentEligibility() )->eligibleForPresentation();
	}

	private function isCheckoutEnabled(): bool {
		if ( ( function_exists( 'is_admin' ) && is_admin() ) ||
			! function_exists( 'is_checkout' ) || ! is_checkout() ||
			( function_exists( 'is_order_received_page' ) && is_order_received_page() ) ||
			( function_exists( 'is_checkout_pay_page' ) && is_checkout_pay_page() ) ) return false;
		if ( null === $this->eligibilityForRequest ) {
			// Local installation-only check; do not await the hosted API on a page load.
			// Fail closed on unexpected local errors without breaking checkout.
			try {
				$this->eligibilityForRequest = (bool) ( $this->eligible )();
			} catch ( \Throwable $error ) {
				CheckoutConsentDiagnostics::warn( 'consent_presentation_eligibility_failed', $error );
				$this->eligibilityForRequest = false;
			}
		}
		return $this->eligibilityForRequest;
	}

	public function register(): void {
		// WooCommerce itself renders the native Additional Checkout Field.
		// No parsed-block injection, custom checkout block or second React root.
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ), 15 );
	}

	public function enqueue(): void {
		if ( ! $this->isCheckoutEnabled() ) return;
		$blocks = function_exists( 'has_block' ) && has_block( 'woocommerce/checkout' );
		// Classic uses Woo-native AJAX so its existing, cookie-bound WC session
		// is present. No standalone REST-session bootstrapping is necessary.
		$config = array_merge( $this->labels(), array(
			'statusEndpoint' => class_exists( '\WC_AJAX' ) ? \WC_AJAX::get_endpoint( 'moda_interact_checkout_consent_status' ) : '',
			'withdrawEndpoint' => class_exists( '\WC_AJAX' ) ? \WC_AJAX::get_endpoint( 'moda_interact_checkout_consent_withdraw' ) : '',
			'nonce' => function_exists( 'wp_create_nonce' ) ? wp_create_nonce( 'wp_rest' ) : '',
			'storeNonce' => function_exists( 'wp_create_nonce' ) ? wp_create_nonce( 'wc_store_api' ) : '',
			'optIn' => CheckoutConsentCheckbox::disclosure()['text'],
		) );
		if ( ! $blocks && ( '' === $config['statusEndpoint'] || '' === $config['withdrawEndpoint'] ||
			! is_string( $config['nonce'] ) || '' === $config['nonce'] ) ) return;
		$handle = $blocks ? 'moda-woo-consent-blocks-status' : 'moda-woo-consent-classic';
		if ( $blocks ) {
			wp_enqueue_script( $handle,
				plugins_url( 'assets/js/checkout-consent-blocks-status.js', MODA_INTERACT_MAIN_PLUGIN_FILE ),
				array( 'wp-data', 'wc-blocks-checkout' ), '1.0.3', true );
		}
		if ( function_exists( 'wp_add_inline_script' ) ) {
			wp_add_inline_script( $handle,
				'window.modaWooCheckoutConsentConfig = ' . wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ) . ';', 'before' );
		}
	}
	/** Consent copy always follows the store Site Language, not a staff locale. */
	private function labels(): array {
		$locale = get_option( 'WPLANG', '' );
		$locale = is_string( $locale ) && preg_match( '/^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/D', $locale )
			? $locale : 'en_US';
		$switched = function_exists( 'switch_to_locale' ) && $locale !== get_locale()
			? switch_to_locale( $locale ) : false;
		try {
			return array(
				'granted' => __( 'WhatsApp permission already granted', 'moda-interact' ),
				'recordedUnverified' => __( 'Your WhatsApp opt-in was recorded, but current permission could not be verified.', 'moda-interact' ),
				'checkStatus' => __( 'Check status', 'moda-interact' ),
				'withdraw' => __( 'Withdraw WhatsApp permission', 'moda-interact' ),
				'confirm' => __( 'Withdraw your WhatsApp permission?', 'moda-interact' ),
				'waitForPhone' => __( 'Enter a billing phone number to save WhatsApp permission.', 'moda-interact' ),
				'changeFailed' => __( 'Could not update WhatsApp permission. Please try again.', 'moda-interact' ),
			);
		} finally {
			if ( $switched ) restore_previous_locale();
		}
	}
}
