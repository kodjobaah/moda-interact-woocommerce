<?php

namespace ModaInteract\WooCommerce\Admin;

defined( 'ABSPATH' ) || exit;

/**
 * ModaInteract Setup Class
 */
class Setup {
	/**
	 * Constructor.
	 *
	 * @since 1.0.0
	 */
	public function __construct() {
		add_action( 'admin_enqueue_scripts', array( $this, 'register_scripts' ) );
		add_action( 'admin_menu', array( $this, 'register_page' ) );
	}

	/**
	 * Load all necessary dependencies.
	 *
	 * @since 1.0.0
	 */
	public function register_scripts() {
		$screen = get_current_screen();
		if ( ! $screen || 'woocommerce_page_wc-admin' !== $screen->id ) {
			return;
		}

		$plugin_path       = dirname( MODA_INTERACT_MAIN_PLUGIN_FILE );
		$script_path       = '/build/index.js';
		$script_asset_path = $plugin_path . '/build/index.asset.php';
		$style_path        = $plugin_path . '/build/index.css';

		if ( ! file_exists( $plugin_path . $script_path ) || ! file_exists( $style_path ) ) {
			return;
		}
		$script_asset      = file_exists( $script_asset_path )
		? require $script_asset_path
		: array(
			'dependencies' => array(),
			'version'      => (string) filemtime( $plugin_path . $script_path ),
		);
		$script_url        = plugins_url( $script_path, MODA_INTERACT_MAIN_PLUGIN_FILE );

		wp_register_script(
			'moda-interact',
			$script_url,
			$script_asset['dependencies'],
			$script_asset['version'],
			true
		);

		wp_register_style(
			'moda-interact',
			plugins_url( '/build/index.css', MODA_INTERACT_MAIN_PLUGIN_FILE ),
			// Add any dependencies styles may have, such as wp-components.
			array(),
			(string) filemtime( $style_path )
		);

		wp_enqueue_script( 'moda-interact' );
		wp_enqueue_style( 'moda-interact' );
	}

	/**
	 * Register page in wc-admin.
	 *
	 * @since 1.0.0
	 */
	public function register_page() {

		if ( ! function_exists( 'wc_admin_register_page' ) ) {
			return;
		}

		wc_admin_register_page(
			array(
				'id'     => 'moda-interact',
				'title'  => __( 'Moda Interact', 'moda-interact' ),
				'parent' => 'woocommerce',
				'path'   => '/moda-interact',
			)
		);
	}
}
