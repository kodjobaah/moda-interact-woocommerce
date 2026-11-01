<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Renders the optional switch control in Classic checkout and Checkout Blocks. */
final class CheckoutOutreachOfferChoicePresenter {
	private readonly CheckoutOutreachCouponChoice $choice;
	private bool $classic_rendered = false;

	public function __construct( ?CheckoutOutreachCouponChoice $choice = null ) {
		$this->choice = $choice ?? new CheckoutOutreachCouponChoice();
	}

	public function register(): void {
		add_action( 'woocommerce_before_checkout_form', array( $this, 'renderClassic' ), 5, 0 );
		add_action( 'woocommerce_blocks_checkout_block_registration', array( $this, 'registerBlocksIntegration' ), 10, 1 );
	}

	public function renderClassic(): void {
		if ( $this->classic_rendered ) return;
		$state = $this->choice->publicState();
		if ( null === $state ) return;
		$this->classic_rendered = true;
		echo $this->form( $state['nonce'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	public function registerBlocksIntegration( mixed $registry ): void {
		$interface = '\\Automattic\\WooCommerce\\Blocks\\Integrations\\IntegrationInterface';
		if ( ! interface_exists( $interface ) || ! is_object( $registry ) || ! method_exists( $registry, 'register' ) ) return;
		$presenter = $this;
		$registry->register( new class( $presenter ) implements \Automattic\WooCommerce\Blocks\Integrations\IntegrationInterface {
			public function __construct( private readonly CheckoutOutreachOfferChoicePresenter $presenter ) {}
			public function get_name(): string { return 'moda-interact-outreach-choice'; }
			public function initialize(): void { $this->presenter->enqueueBlocksScript(); }
			public function get_script_handles(): array { return array( 'moda-interact-outreach-choice' ); }
			public function get_editor_script_handles(): array { return array(); }
			public function get_script_data(): array { return $this->presenter->blocksScriptData(); }
		} );
	}

	public function enqueueBlocksScript(): void {
		$path = dirname( __DIR__, 2 ) . '/build/checkout-outreach-choice.js';
		if ( ! is_file( $path ) ) return;
		$asset_path = dirname( __DIR__, 2 ) . '/build/checkout-outreach-choice.asset.php';
		$asset = is_file( $asset_path ) ? require $asset_path : array( 'dependencies' => array(), 'version' => (string) filemtime( $path ) );
		$dependencies = array_unique( array_merge( $asset['dependencies'] ?? array(), array( 'wp-element', 'wp-plugins', 'wc-settings', 'wc-blocks-checkout' ) ) );
		wp_register_script( 'moda-interact-outreach-choice', plugins_url( 'build/checkout-outreach-choice.js', dirname( __DIR__, 2 ) . '/moda-interact.php' ),
			$dependencies, $asset['version'] ?? null, true );
	}

	public function blocksScriptData(): array {
		$state = $this->choice->publicState();
		return array(
			'available' => null !== $state,
			'nonce' => $state['nonce'] ?? '',
			'action' => CheckoutOutreachCouponChoice::ACTION_FIELD,
			'checkoutUrl' => function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : home_url( '/' ),
			'buttonText' => __( 'Try the offered coupons instead', 'moda-interact' ),
		);
	}

	private function form( string $nonce ): string {
		$action = function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : home_url( '/' );
		return '<div class="moda-interact-outreach-choice"><form method="post" action="' . esc_url( $action ) . '">' .
			'<input type="hidden" name="' . esc_attr( CheckoutOutreachCouponChoice::ACTION_FIELD ) . '" value="try_offered">' .
			'<input type="hidden" name="_wpnonce" value="' . esc_attr( $nonce ) . '">' .
			'<button type="submit">' . esc_html__( 'Try the offered coupons instead', 'moda-interact' ) . '</button></form></div>';
	}
}
