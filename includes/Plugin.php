<?php

namespace ModaInteract\WooCommerce;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Admin\Setup;

final class Plugin {
	private static ?Runtime $runtime = null;

	public static function activate(): void {
	}

	public static function deactivate(): void {
	}

	public static function boot(): void {
		if ( null === self::$runtime ) {
			self::$runtime = new Runtime( self::woocommerce_version() );
		}

		self::$runtime->boot();
	}

	public static function load_textdomain(): void {
		load_plugin_textdomain(
			'moda-interact',
			false,
			plugin_basename( dirname( MODA_INTERACT_MAIN_PLUGIN_FILE ) ) . '/languages'
		);
	}

	public static function woocommerce_version(): ?string {
		if ( ! class_exists( 'WooCommerce' ) || ! defined( 'WC_VERSION' ) ) {
			return null;
		}

		return (string) constant( 'WC_VERSION' );
	}
}