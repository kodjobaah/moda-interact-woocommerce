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

	/**
	 * The current extension does not read or write WooCommerce order storage.
	 */
	public static function declare_hpos_compatibility(): void {
		if ( ! class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			return;
		}

		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
			'custom_order_tables',
			MODA_INTERACT_MAIN_PLUGIN_FILE,
			true
		);
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