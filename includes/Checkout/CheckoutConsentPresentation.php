<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Presentation only: the server-owned API-006 proof controls which view appears. */
final class CheckoutConsentPresentation {
	private $eligible;
	private ?bool $eligibilityForRequest = null;

	public function __construct( ?callable $eligible = null ) {
		$this->eligible = $eligible ?? static fn(): bool => ( new CheckoutConsentEligibility() )->eligible();
	}

	private function isCheckoutEnabled(): bool {
		if ( ( function_exists( 'is_admin' ) && is_admin() ) ||
			! function_exists( 'is_checkout' ) || ! is_checkout() ||
			( function_exists( 'is_order_received_page' ) && is_order_received_page() ) ||
			( function_exists( 'is_checkout_pay_page' ) && is_checkout_pay_page() ) ) return false;
		if ( null === $this->eligibilityForRequest ) {
			// One eligibility read per page request, not another hosted API call
			// every time WooCommerce renders an inner checkout block.
			$this->eligibilityForRequest = (bool) ( $this->eligible )();
		}
		return $this->eligibilityForRequest;
	}

	public function register(): void {
		add_action( 'init', array( $this, 'registerCheckoutBlock' ), 20 );
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueueBlockEditor' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ), 15 );
		// Existing checkout pages do not contain our block in saved post_content.
		// Add a real parsed inner block BEFORE WP_Block builds/renders its children;
		// the Woo registry is the only frontend renderer (no second React root).
		add_filter( 'render_block_data', array( $this, 'insertCheckoutConsentBlock' ), 20, 1 );
	}

	/**
	 * The Blocks consent UI belongs to the checkout-fields (left) column.
	 * ExperimentalOrderMeta belongs to the order summary and must not be used
	 * for a customer-facing consent control. Woo's checkout block registry
	 * replaces this named inner block with the React consent component.
	 */
	public function registerCheckoutBlock(): void {
		if ( ! function_exists( 'register_block_type' ) ) return;
		$metadata = dirname( __DIR__, 2 ) . '/assets/blocks/checkout-consent';
		register_block_type( $metadata, array(
			'render_callback' => static fn(): string =>
				'<div data-block-name="moda-interact/checkout-consent" class="moda-woo-checkout-consent"></div>',
		) );
		// Woo needs this attribute on custom-namespaced inner blocks to mount
		// its registered frontend React checkout block in the correct region.
		add_filter( '__experimental_woocommerce_blocks_add_data_attributes_to_block',
			static function ( array $blocks ): array {
				$blocks[] = 'moda-interact/checkout-consent';
				return array_values( array_unique( $blocks ) );
			}, 10, 1 );
	}

	/**
	 * Insert a real Checkout Fields child for previously saved checkout pages.
	 * render_block_data runs before WP_Block builds inner_blocks; modifying the
	 * rendered HTML later cannot register an actual Woo inner block.
	 * Never persist or rewrite a merchant's checkout post_content.
	 *
	 * @param array $parsed WordPress parsed block data (not rendered HTML).
	 */
	public function insertCheckoutConsentBlock( array $parsed ): array {
		if ( ( $parsed['blockName'] ?? null ) !== 'woocommerce/checkout-fields-block' ||
			! $this->isCheckoutEnabled() ) return $parsed;
		$children = $parsed['innerBlocks'] ?? null;
		$content = $parsed['innerContent'] ?? null;
		if ( ! is_array( $children ) || ! is_array( $content ) ) return $parsed;
		$insert = count( $children );
		foreach ( $children as $index => $child ) {
			if ( ! is_array( $child ) ) return $parsed;
			if ( ( $child['blockName'] ?? null ) === 'moda-interact/checkout-consent' ) return $parsed;
			if ( ( $child['blockName'] ?? null ) === 'woocommerce/checkout-actions-block' ) {
				$insert = $index;
				break;
			}
		}

		// WordPress pairs one null in innerContent with each parsed child.
		// Refuse malformed/unknown layouts rather than render outside Checkout Fields.
		$slots = array();
		foreach ( $content as $position => $fragment ) {
			if ( null === $fragment ) $slots[] = $position;
		}
		if ( count( $slots ) !== count( $children ) ) return $parsed;
		if ( $insert < count( $children ) ) {
			$contentPosition = $slots[ $insert ];
		} elseif ( count( $children ) > 0 ) {
			$contentPosition = $slots[ count( $slots ) - 1 ] + 1;
		} else {
			// No existing children: split the closing wrapper so the injected
			// block still belongs INSIDE Checkout Fields (not its sibling).
			if ( 1 !== count( $content ) || ! is_string( $content[0] ) ||
				! preg_match( '~</div>\s*$~iD', $content[0], $closing, PREG_OFFSET_CAPTURE ) ) return $parsed;
			$before = substr( $content[0], 0, $closing[0][1] );
			$after = substr( $content[0], $closing[0][1] );
			$content = array( $before, $after );
			$contentPosition = 1;
		}
		array_splice( $children, $insert, 0, array( array(
			'blockName' => 'moda-interact/checkout-consent',
			'attrs' => array( 'lock' => array( 'remove' => true, 'move' => true ) ),
			'innerBlocks' => array(),
			'innerHTML' => '',
			'innerContent' => array(),
		) ) );
		array_splice( $content, $contentPosition, 0, array( null ) );
		$parsed['innerBlocks'] = $children;
		$parsed['innerContent'] = $content;
		return $parsed;
	}

	/** Register the editor-side type so the forced inner block is not unknown. */
	public function enqueueBlockEditor(): void {
		if ( ! function_exists( 'wp_enqueue_script' ) ) return;
		wp_enqueue_script( 'moda-woo-consent-editor',
			plugins_url( 'assets/js/checkout-consent-editor.js', MODA_INTERACT_MAIN_PLUGIN_FILE ),
			array( 'wp-blocks', 'wp-element' ), '1.0.2', true );
		if ( function_exists( 'wp_add_inline_script' ) ) {
			wp_add_inline_script( 'moda-woo-consent-editor',
				'window.modaWooConsentEditorLabel = ' . wp_json_encode(
					__( 'Send me WhatsApp shopping updates, reminders and offers.', 'moda-interact' ) ) . ';',
				'before' );
		}
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
				array( 'wp-element', 'wp-data', 'wc-blocks-checkout' ), '1.0.2', true );
		}
		if ( $blocks && function_exists( 'wp_enqueue_style' ) ) {
			wp_enqueue_style( 'moda-woo-checkout-consent',
				plugins_url( 'assets/css/checkout-consent.css', MODA_INTERACT_MAIN_PLUGIN_FILE ),
				array(), '1.0.2' );
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
