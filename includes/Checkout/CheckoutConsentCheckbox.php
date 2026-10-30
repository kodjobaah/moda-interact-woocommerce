<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Presentation only. No checkbox value is ever interpreted as customer permission here. */
final class CheckoutConsentCheckbox {
	public const CLASSIC_FIELD = 'moda_interact_whatsapp_recovery_opt_in';
	public const BLOCK_FIELD = 'moda-interact/whatsapp-recovery-opt-in';

	public const DISCLOSURE_VERSION = 'moda.woo.whatsapp-recovery-marketing.v3';

	private $eligible;
	private bool $registered = false;

	public function __construct( ?callable $eligible = null ) {
		$this->eligible = $eligible ?? static fn(): bool => ( new CheckoutConsentEligibility() )->eligible();
	}

	public function register(): void {
		// Classic fields are requested by Woo on the checkout request itself.
		add_filter( 'woocommerce_checkout_fields', array( $this, 'classicFields' ), 20, 1 );
		add_action( 'woocommerce_after_checkout_billing_form', array( $this, 'renderClassicPermission' ), 20 );
		// Blocks owns one controlled checkbox in Checkout Fields using Woo Store
		// API; do not register a duplicate Additional Checkout Field.
	}

	/**
	 * Concise versioned consent text shared by Classic, Blocks and API evidence.
	 * Use the shop's configured Site Language, not a logged-in admin's locale.
	 * The authenticated installation supplies the merchant identity to the API.
	 */
	public static function disclosure(): array {
		$configured_locale = get_option( 'WPLANG', '' );
		$locale = is_string( $configured_locale ) && preg_match( '/^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/D', $configured_locale )
			? $configured_locale : 'en_US';
		$switched = function_exists( 'switch_to_locale' ) && $locale !== get_locale()
			? switch_to_locale( $locale ) : false;
		try {
			$text = __( 'Send me WhatsApp shopping updates, reminders and offers.', 'moda-interact' );
		} finally {
			if ( $switched ) restore_previous_locale();
		}
		return array(
			'version' => self::DISCLOSURE_VERSION,
			'locale' => str_replace( '_', '-', $locale ),
			'text' => $text,
		);
	}

	/** Classic checkout official field API; no custom theme/DOM insertion. */
	public function classicFields( array $fields ): array {
		if ( ! ( $this->eligible )() ) return $fields;
		if ( ! isset( $fields['billing'] ) || ! is_array( $fields['billing'] ) ) return $fields;
		if ( isset( $fields['billing'][ self::CLASSIC_FIELD ] ) ) return $fields;
		$billing_phone_priority = $fields['billing']['billing_phone']['priority'] ?? 100;
		$fields['billing'][ self::CLASSIC_FIELD ] = array(
			'type' => 'checkbox',
			'label' => self::disclosure()['text'],
			'required' => false,
			'default' => 0,
			'priority' => is_numeric( $billing_phone_priority ) ? (int) $billing_phone_priority + 1 : 110,
			'class' => array( 'form-row-wide' ),
			'custom_attributes' => array(
				'data-moda-consent-version' => self::DISCLOSURE_VERSION,
				'data-moda-consent-locale' => self::disclosure()['locale'],
			),
		);
		// Withdrawing is a separate proof-backed action, never a select field.
		// API-006 must verify current consent before any withdrawal UI is exposed.
		return $fields;
	}

	/** Native Classic checkout hook: a separate, initially hidden withdrawal UI.
	 * Labels are filled from server-localised checkout config in the browser.
	 * Never render proof, recipient phone or a prechecked permission field.
	 */
	public function renderClassicPermission(): void {
		if ( ! function_exists( 'is_checkout' ) || ! is_checkout() ||
			( function_exists( 'is_order_received_page' ) && is_order_received_page() ) ||
			( function_exists( 'is_checkout_pay_page' ) && is_checkout_pay_page() ) ||
			( function_exists( 'has_block' ) && has_block( 'woocommerce/checkout' ) ) ||
			! ( $this->eligible )() ) return;
		echo '<div id="moda-woo-consent-current-status" hidden aria-live="polite">' .
			'<p id="moda-woo-consent-granted-label"></p>' .
			'<button type="button" id="moda-woo-consent-withdraw" class="button"></button>' .
			'<p id="moda-woo-consent-action-error" role="alert" hidden></p>' .
			'</div>';
	}

	public function registerBlocksForCheckoutPage(): void {
		if ( function_exists( 'is_checkout' ) && is_checkout() &&
			( ! function_exists( 'is_order_received_page' ) || ! is_order_received_page() ) &&
			( ! function_exists( 'is_checkout_pay_page' ) || ! is_checkout_pay_page() ) ) {
			$this->registerBlocksField();
		}
	}

	/** The Store API and normal checkout page use the same fresh eligibility. */
	public function registerBlocksForStoreApi(): void {
		$uri = $_SERVER['REQUEST_URI'] ?? '';
		if ( ! is_string( $uri ) || strlen( $uri ) > 2048 ) return;
		$path = parse_url( $uri, PHP_URL_PATH );
		$query = parse_url( $uri, PHP_URL_QUERY );
		if ( is_string( $query ) ) {
			parse_str( $query, $params );
			if ( is_string( $params['rest_route'] ?? null ) ) $path = $params['rest_route'];
		}
		if ( is_string( $path ) && preg_match( '~(?:^|/)wc/store/v[0-9]+/checkout(?:/|$)~D', $path ) ) {
			$this->registerBlocksField();
		}
	}

	public function registerBlocksField(): void {
		// This registered Additional Checkout Field would remain visibly unchecked
		// even after API-006 confirms an existing grant. The Blocks consent control
		// now belongs to the Woo registered checkout inner block, which renders
		// either existing permission or a fresh unchecked opt-in as appropriate.
		// No additional field is registered (and none is persisted on the order).
		$this->registered = true;
	}
}
