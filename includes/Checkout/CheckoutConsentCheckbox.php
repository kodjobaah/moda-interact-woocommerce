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
		$this->eligible = $eligible ?? static fn(): bool => ( new CheckoutConsentEligibility() )->eligibleForPresentation();
	}

	public function register(): void {
		add_filter( 'woocommerce_checkout_fields', array( $this, 'classicFields' ), 20, 1 );
		// Native Checkout Fields must be registered during WooCommerce initialization,
		// BEFORE the Blocks checkout tree and its Store API field definitions are built.
		// Runtime::initialize() itself runs on woocommerce_init. Do not defer to
		// WordPress `wp` or `rest_api_init`, which can be too late for the page.
		if ( function_exists( 'did_action' ) && did_action( 'woocommerce_init' ) ) {
			$this->registerBlocksAtInit();
		} else {
			add_action( 'woocommerce_init', array( $this, 'registerBlocksAtInit' ), 20 );
		}
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
		try {
			if ( ! ( $this->eligible )() ) return $fields;
		} catch ( \Throwable $error ) {
			CheckoutConsentDiagnostics::warn( 'classic_consent_field_eligibility_failed', $error );
			return $fields;
		}
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
		// One native checkbox; its checked state is set by client-side proof verification.
		return $fields;
	}

	/**
	 * Register early using only local installation configuration. A slow hosted
	 * feature request must never prevent checkout rendering. The URL comparison
	 * uses the configured Woo checkout permalink before
	 * WordPress has resolved the main query; is_checkout()/has_block() are not
	 * reliable yet at woocommerce_init.
	 */
	public function registerBlocksAtInit(): void {
		if ( $this->registered || ! function_exists( 'woocommerce_register_additional_checkout_field' ) ) return;
		if ( self::isStoreApiRequest() ) {
			// Store API routes must have the same field identity even without a
			// frontend query. Their actions still have independent security gates.
			$this->registerBlocksField();
			return;
		}
		if ( ! self::isCheckoutDocumentRequest() ) return;
		try {
			if ( ( $this->eligible )() ) {
				$this->registerBlocksField();
			}
		} catch ( \Throwable $error ) {
			CheckoutConsentDiagnostics::warn( 'native_consent_field_eligibility_failed', $error );
		}
	}

	private static function isCheckoutDocumentRequest(): bool {
		if ( function_exists( 'is_admin' ) && is_admin() ) return false;
		if ( ! function_exists( 'get_permalink' ) || ! function_exists( 'get_option' ) ) return false;
		$page_id = get_option( 'woocommerce_checkout_page_id', 0 );
		if ( ! is_numeric( $page_id ) || (int) $page_id <= 0 ) return false;
		$permalink = get_permalink( (int) $page_id );
		$uri = $_SERVER['REQUEST_URI'] ?? '';
		if ( ! is_string( $permalink ) || '' === $permalink ||
			! is_string( $uri ) || strlen( $uri ) > 2048 ) return false;
		$page_path = parse_url( $permalink, PHP_URL_PATH );
		$request_path = parse_url( $uri, PHP_URL_PATH );
		if ( ! is_string( $page_path ) || ! is_string( $request_path ) ) return false;
		parse_str( (string) parse_url( $uri, PHP_URL_QUERY ), $query );
		if ( isset( $query['order-pay'] ) || isset( $query['order-received'] ) ) return false;
		// WooCommerce's disposable browser fixture and WordPress plain
		// permalinks can request the checkout by its actual ?page_id even when
		// get_permalink() returns a pretty /checkout/ URL.
		if ( isset( $query['page_id'] ) || isset( $query['p'] ) ) {
			$id = $query['page_id'] ?? $query['p'];
			$home_path = parse_url( (string) home_url( '/' ), PHP_URL_PATH );
			return is_scalar( $id ) && ctype_digit( (string) $id ) && (int) $id === (int) $page_id &&
				( null === $home_path || is_string( $home_path ) ) &&
				rtrim( (string) $home_path, '/' ) === rtrim( $request_path, '/' );
		}
		if ( rtrim( $page_path, '/' ) !== rtrim( $request_path, '/' ) ) return false;
		return true;
	}

	private static function isStoreApiRequest(): bool {
		$uri = $_SERVER['REQUEST_URI'] ?? '';
		if ( ! is_string( $uri ) || strlen( $uri ) > 2048 ) return false;
		$path = parse_url( $uri, PHP_URL_PATH );
		parse_str( (string) parse_url( $uri, PHP_URL_QUERY ), $params );
		if ( is_string( $params['rest_route'] ?? null ) ) $path = $params['rest_route'];
		return is_string( $path ) &&
			1 === preg_match( '~(?:^|/)wc/store/v[0-9]+/(?:checkout|cart)(?:/|$)~D', $path );
	}

	/** The native field renders the UI, but MUST NOT persist consent evidence. */
	public function registerBlocksField(): void {
		if ( $this->registered || ! function_exists( 'woocommerce_register_additional_checkout_field' ) ) return;
		$disclosure = self::disclosure();
		try {
			$registration = woocommerce_register_additional_checkout_field( array(
				'id' => self::BLOCK_FIELD,
				'label' => $disclosure['text'],
				'optionalLabel' => $disclosure['text'],
				'location' => 'contact',
				'type' => 'checkbox',
				'required' => false,
				'attributes' => array(
					'data-moda-consent-control' => '1',
					'data-moda-consent-version' => self::DISCLOSURE_VERSION,
					'data-moda-consent-locale' => $disclosure['locale'],
				),
				// WooCommerce may save additional fields to customer/order meta.
				// Always coerce this *display-only* value to false; a saved field
				// can never become proof of WhatsApp consent on a future visit.
				'sanitize_callback' => static fn( mixed $value ): bool => false,
			) );
			if ( function_exists( 'is_wp_error' ) && is_wp_error( $registration ) ) {
				CheckoutConsentDiagnostics::warn( 'native_consent_field_registration_rejected' );
				return;
			}
			add_filter( 'woocommerce_get_default_value_for_' . self::BLOCK_FIELD,
				static fn(): bool => false, 10, 3 );
			$this->registered = true;
		} catch ( \Throwable $error ) {
			CheckoutConsentDiagnostics::warn( 'native_consent_field_registration_failed', $error );
		}
	}
}
