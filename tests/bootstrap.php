<?php

use ModaInteract\WooCommerce\Plugin;

define( 'ABSPATH', dirname( __DIR__ ) . '/' );
$GLOBALS['moda_interact_test_hooks'] = array();
$GLOBALS['moda_interact_registered_pages'] = array();
$GLOBALS['moda_interact_is_admin'] = true;
$GLOBALS['moda_interact_can_activate_plugins'] = true;
$GLOBALS['moda_interact_current_screen_id'] = 'woocommerce_page_wc-admin';
$GLOBALS['moda_interact_registered_scripts'] = array();
$GLOBALS['moda_interact_registered_styles'] = array();
$GLOBALS['moda_interact_enqueued_scripts'] = array();
$GLOBALS['moda_interact_enqueued_styles'] = array();
$GLOBALS['moda_interact_external_requests'] = array();
$GLOBALS['moda_interact_deleted_options'] = array();
define( 'WC_VERSION', '11.1.2' );

function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	$GLOBALS['moda_interact_test_hooks'][ $hook ][] = $callback;
}

function register_activation_hook( $file, $callback ) {
	$GLOBALS['moda_interact_activation_callback'] = $callback;
}

function register_deactivation_hook( $file, $callback ) {
	$GLOBALS['moda_interact_deactivation_callback'] = $callback;
}

function load_plugin_textdomain( $domain, $deprecated = false, $plugin_rel_path = false ) {
	$GLOBALS['moda_interact_loaded_textdomain'] = $domain;
}

function plugin_basename( $file ) {
	return basename( dirname( $file ) ) . '/' . basename( $file );
}

function is_admin() {
	return $GLOBALS['moda_interact_is_admin'];
}

function current_user_can( $capability ) {
	return 'activate_plugins' === $capability && $GLOBALS['moda_interact_can_activate_plugins'];
}

function get_current_screen() {
	return (object) array( 'id' => $GLOBALS['moda_interact_current_screen_id'] );
}

function __( $text, $domain = 'default' ) {
	return $text;
}

function esc_html__( $text, $domain = 'default' ) {
	return $text;
}

function esc_html( $text ) {
	return $text;
}

function wc_admin_register_page( $page ) {
	$GLOBALS['moda_interact_registered_pages'][] = $page;
}

function plugins_url( $path, $plugin_file ) {
	return 'https://example.org/plugins' . $path;
}

function wp_register_script( $handle, $src, $dependencies, $version, $in_footer ) {
	$GLOBALS['moda_interact_registered_scripts'][] = $handle;
}

function wp_register_style( $handle, $src, $dependencies, $version ) {
	$GLOBALS['moda_interact_registered_styles'][] = $handle;
}

function wp_enqueue_script( $handle ) {
	$GLOBALS['moda_interact_enqueued_scripts'][] = $handle;
}

function wp_enqueue_style( $handle ) {
	$GLOBALS['moda_interact_enqueued_styles'][] = $handle;
}

function wp_remote_request( ...$args ) {
	$GLOBALS['moda_interact_external_requests'][] = $args;
}

function delete_option( $option ) {
	$GLOBALS['moda_interact_deleted_options'][] = $option;
}

class WooCommerce {}

require_once dirname( __DIR__ ) . '/vendor/autoload.php';
require_once dirname( __DIR__ ) . '/moda-interact.php';
$GLOBALS['moda_interact_initial_hooks'] = $GLOBALS['moda_interact_test_hooks'];