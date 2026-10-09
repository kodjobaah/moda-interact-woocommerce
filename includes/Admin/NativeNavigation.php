<?php

namespace ModaInteract\WooCommerce\Admin;

defined( 'ABSPATH' ) || exit;

/**
 * Native WordPress navigation for the WooCommerce Moda Interact extension.
 * The three implemented screens reuse the existing React page and controllers.
 */
final class NativeNavigation {
	public const ROOT_SLUG = 'moda-interact';

	private const CAPABILITY = 'manage_woocommerce';

	/** @var string[] */
	private array $application_screens = array();

	public function register(): void {
		$root_hook = add_menu_page(
			__( 'Moda Interact', 'moda-interact' ),
			__( 'Moda Interact', 'moda-interact' ),
			self::CAPABILITY,
			self::ROOT_SLUG,
			array( $this, 'render_application' ),
			'dashicons-store',
			56
		);
		$this->remember_screen( $root_hook );

		// Reuse the parent slug to avoid WordPress inserting a duplicate first item.
		add_submenu_page(
			self::ROOT_SLUG,
			__( 'Overview', 'moda-interact' ),
			__( 'Overview', 'moda-interact' ),
			self::CAPABILITY,
			self::ROOT_SLUG,
			array( $this, 'render_application' )
		);

		$this->register_planned( 'moda-interact-recoveries', __( 'Recoveries', 'moda-interact' ) );
		$this->register_application( 'moda-interact-billing', __( 'Billing', 'moda-interact' ) );
		$this->register_planned( 'moda-interact-promotions', __( 'Promotions', 'moda-interact' ) );
		$this->register_planned( 'moda-interact-support', __( 'Support', 'moda-interact' ) );
		$this->register_application( 'moda-interact-recovery-settings', __( 'Recovery settings', 'moda-interact' ) );
	}

	public function is_application_screen( string $screen_id ): bool {
		return in_array( $screen_id, $this->application_screens, true );
	}

	public function render_application(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}

		echo '<div class="wrap moda-interact-native-admin"><div id="moda-interact-native-root"></div></div>';
	}

	private function register_application( string $slug, string $label ): void {
		$hook = add_submenu_page(
			self::ROOT_SLUG,
			$label,
			$label,
			self::CAPABILITY,
			$slug,
			array( $this, 'render_application' )
		);
		$this->remember_screen( $hook );
	}

	private function register_planned( string $slug, string $label ): void {
		add_submenu_page(
			self::ROOT_SLUG,
			$label,
			$label,
			self::CAPABILITY,
			$slug,
			function () use ( $label ): void {
				if ( ! current_user_can( self::CAPABILITY ) ) {
					return;
				}
				echo '<div class="wrap">';
				echo '<h1>' . esc_html( $label ) . '</h1>';
				echo '<p>' . esc_html( __( 'This section is not yet available for WooCommerce.', 'moda-interact' ) ) . '</p>';
				echo '</div>';
			}
		);
	}

	private function remember_screen( $hook ): void {
		if ( is_string( $hook ) ) {
			$this->application_screens[] = $hook;
		}
	}
}
