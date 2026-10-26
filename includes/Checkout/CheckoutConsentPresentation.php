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
		// Existing checkout pages do not automatically acquire a new saved inner
		// block when the plugin is installed. Insert its runtime-only mount point
		// into the Checkout Fields column, without updating post_content.
		add_filter( 'render_block_woocommerce/checkout-fields-block', array( $this, 'renderCheckoutFields' ), 20, 2 );
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
	 * Supply a transient frontend mount point on already-existing checkout pages.
	 * A PHP block registration and an editor-only block definition do not write
	 * the custom block into a merchant's previously saved checkout post content.
	 * The Woo Blocks registry requires a data-block-name marker in the rendered
	 * Checkout Fields subtree before it can mount the React consent component.
	 *
	 * Only the LEFT Checkout Fields block is changed, never Checkout Totals.
	 * Do not inject DOM nodes from JavaScript or persist/overwrite the template.
	 */
	public function renderCheckoutFields( string $content, array $block = array() ): string {
		if ( ! $this->isCheckoutEnabled() ) return $content;
		if ( false !== strpos( $content, 'data-block-name="moda-interact/checkout-consent"' ) ) return $content;
		if ( false === strpos( $content, 'data-block-name="woocommerce/checkout-fields-block"' ) &&
			false === strpos( $content, 'wp-block-woocommerce-checkout-fields-block' ) ) return $content;

		// Distinguish a runtime-inserted placeholder from an actual saved inner
		// block. The latter is owned by Woo's checkout-block renderer; only
		// runtime placeholders may receive our WordPress element root.
		$mount = '<div data-block-name="moda-interact/checkout-consent"' .
			' data-moda-woo-runtime-mount="1"' .
			' class="wp-block-moda-interact-checkout-consent"></div>';
		// Place immediately before the Place Order actions when present.
		if ( preg_match( '~<div\b[^>]*data-block-name=["\']woocommerce/checkout-actions-block["\'][^>]*>~', $content, $match, PREG_OFFSET_CAPTURE ) ) {
			return substr_replace( $content, $mount, $match[0][1], 0 );
		}
		// Woo versions/templates without a separate actions child still have
		// the closing Checkout Fields wrapper. Reject unexpected markup rather
		// than accidentally mounting in Order Summary or outside checkout.
		$closing = strripos( $content, '</div>' );
		if ( false === $closing || '' !== trim( substr( $content, $closing + 6 ) ) ) return $content;
		return substr_replace( $content, $mount, $closing, 0 );
	}

	/** Register the editor-side type so the forced inner block is not unknown. */
	public function enqueueBlockEditor(): void {
		if ( ! function_exists( 'wp_enqueue_script' ) ) return;
		wp_enqueue_script( 'moda-woo-consent-editor',
			plugins_url( 'assets/js/checkout-consent-editor.js', MODA_INTERACT_MAIN_PLUGIN_FILE ),
			array( 'wp-blocks', 'wp-element' ), '1.0.1', true );
		if ( function_exists( 'wp_add_inline_script' ) ) {
			wp_add_inline_script( 'moda-woo-consent-editor',
				'window.modaWooConsentEditorLabel = ' . wp_json_encode(
					__( 'Send me WhatsApp shopping updates, reminders and offers.', 'moda-interact' ) ) . ';',
				'before' );
		}
	}

	public function enqueue(): void {
		if ( ! $this->isCheckoutEnabled() ) return;
		$config = array_merge( $this->labels(), array(
			'endpoint' => function_exists( 'rest_url' ) ? rest_url( 'moda-interact/v1/checkout-consent/' ) : '',
			'nonce' => function_exists( 'wp_create_nonce' ) ? wp_create_nonce( 'wp_rest' ) : '',
			'storeNonce' => function_exists( 'wp_create_nonce' ) ? wp_create_nonce( 'wc_store_api' ) : '',
			'optIn' => CheckoutConsentCheckbox::disclosure()['text'],
		) );
		if ( ! is_string( $config['endpoint'] ) || '' === $config['endpoint'] ||
			! is_string( $config['nonce'] ) || '' === $config['nonce'] ) return;
		$blocks = function_exists( 'has_block' ) && has_block( 'woocommerce/checkout' );
		$handle = $blocks ? 'moda-woo-consent-blocks-status' : 'moda-woo-consent-classic';
		if ( $blocks ) {
			wp_enqueue_script( $handle,
				plugins_url( 'assets/js/checkout-consent-blocks-status.js', MODA_INTERACT_MAIN_PLUGIN_FILE ),
				array( 'wp-element', 'wp-data', 'wc-blocks-checkout' ), '1.0.1', true );
		}
		if ( $blocks && function_exists( 'wp_enqueue_style' ) ) {
			wp_enqueue_style( 'moda-woo-checkout-consent',
				plugins_url( 'assets/css/checkout-consent.css', MODA_INTERACT_MAIN_PLUGIN_FILE ),
				array(), '1.0.1' );
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
