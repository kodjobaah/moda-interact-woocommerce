<?php

namespace ModaInteract\WooCommerce\Admin;

defined( 'ABSPATH' ) || exit;

/**
 * ModaInteract Setup Class
 */
class Setup {
	private NativeNavigation $native_navigation;

	/**
	 * Constructor.
	 *
	 * @since 1.0.0
	 */
	public function __construct() {
		$this->native_navigation = new NativeNavigation();
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
		if ( ! $screen || ( 'woocommerce_page_wc-admin' !== $screen->id && ! $this->native_navigation->is_application_screen( $screen->id ) ) ) {
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
			(string) filemtime( $plugin_path . $script_path ),
			true
		);
		wp_set_script_translations( 'moda-interact', 'moda-interact', $plugin_path . '/languages' );

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
		$this->native_navigation->register();

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
