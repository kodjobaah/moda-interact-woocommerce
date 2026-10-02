<?php

namespace ModaInteract\WooCommerce;

use ModaInteract\WooCommerce\Admin\Setup;

final class Plugin {
	public static function activate(): void {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( self::class, 'missing_woocommerce_notice' ) );
		}
	}

	public static function boot(): void {
		load_plugin_textdomain(
			'moda-interact',
			false,
			plugin_basename( dirname( MODA_INTERACT_MAIN_PLUGIN_FILE ) ) . '/languages'
		);

		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( self::class, 'missing_woocommerce_notice' ) );
			return;
		}

		if ( is_admin() ) {
			new Setup();
		}
	}

	public static function missing_woocommerce_notice(): void {
		$message = esc_html__(
			'Moda Interact requires WooCommerce to be installed and active.',
			'moda-interact'
		);

		echo '<div class="notice notice-error"><p>' . esc_html( $message ) . '</p></div>';
	}
}