<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Presentation only. No checkbox value is ever interpreted as customer permission here. */
final class CheckoutConsentCheckbox {
	public const CLASSIC_FIELD = 'moda_interact_whatsapp_recovery_opt_in';
	public const BLOCK_FIELD = 'moda-interact/whatsapp-recovery-opt-in';
	public const DISCLOSURE_VERSION = 'moda.woo.whatsapp-recovery-marketing.v1';

	private $eligible;
	private bool $registered = false;

	public function __construct( ?callable $eligible = null ) {
		$this->eligible = $eligible ?? static fn(): bool => ( new CheckoutConsentEligibility() )->eligible();
	}

	public function register(): void {
		// Classic fields are requested by Woo on the checkout request itself.
		add_filter( 'woocommerce_checkout_fields', array( $this, 'classicFields' ), 20, 1 );
		// Woo's supported additional-field API may register after woocommerce_init;
		// `wp` has the resolved checkout query, while REST needs its own lifecycle.
		add_action( 'wp', array( $this, 'registerBlocksForCheckoutPage' ), 5, 0 );
		add_action( 'rest_api_init', array( $this, 'registerBlocksForStoreApi' ), 0, 0 );
	}

	/** Identical, versioned disclosure for both checkout modes and later API evidence. */
	public static function disclosure(): array {
		$store = trim( strip_tags( (string) get_option( 'blogname', '' ) ) );
		if ( '' === $store ) {
			$hostname = parse_url( home_url( '/' ), PHP_URL_HOST );
			$store = is_string( $hostname ) && '' !== $hostname ? $hostname : 'this store';
		}
		$site_url = rtrim( (string) home_url( '/' ), '/' );
		$connection = ( new \ModaInteract\WooCommerce\Connection\InstallationStore() )->read();
		if ( 'valid' === $connection['state'] ) $site_url = $connection['record']['canonicalSiteUrl'];
		return array(
			'version' => self::DISCLOSURE_VERSION,
			'locale' => str_replace( '_', '-', get_locale() ),
			'text' => sprintf(
				/* translators: %s: the merchant's displayed store name. */
				__( 'I agree to receive WhatsApp marketing reminders from %s about items left in an unfinished checkout at this store, sent to my billing phone number. Optional; I can withdraw by contacting the store. An unchecked box does not revoke any consent I gave previously.', 'moda-interact' ),
				$store
			) . ' (' . $site_url . ')',
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
		return $fields;
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
		if ( $this->registered || ! function_exists( 'woocommerce_register_additional_checkout_field' ) ) return;
		if ( ! ( $this->eligible )() ) return;
		$label = self::disclosure()['text'];
		// 'order' (not 'contact') prevents prior customer-profile consent from
		// being hydrated into a checked box at the next checkout. This value is
		// NOT abandonment-time consent evidence; WOOCOMMERCE-002 owns that write.
		woocommerce_register_additional_checkout_field( array(
			'id' => self::BLOCK_FIELD,
			'location' => 'order',
			'type' => 'checkbox',
			'label' => $label,
			'optionalLabel' => $label,
			'required' => false,
			'attributes' => array(
				'data-moda-consent-version' => self::DISCLOSURE_VERSION,
				'data-moda-consent-locale' => self::disclosure()['locale'],
			),
		) );
		$this->registered = true;
	}
}
