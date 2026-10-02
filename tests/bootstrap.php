<?php

use ModaInteract\WooCommerce\Plugin;

define( 'ABSPATH', dirname( __DIR__ ) . '/' );
$GLOBALS['moda_interact_test_hooks'] = array();
$GLOBALS['moda_interact_registered_pages'] = array();

function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	$GLOBALS['moda_interact_test_hooks'][ $hook ][] = $callback;
}

function register_activation_hook( $file, $callback ) {
	$GLOBALS['moda_interact_activation_callback'] = $callback;
}

function load_plugin_textdomain( $domain, $deprecated = false, $plugin_rel_path = false ) {
	$GLOBALS['moda_interact_loaded_textdomain'] = $domain;
}

function plugin_basename( $file ) {
	return basename( dirname( $file ) ) . '/' . basename( $file );
}

function is_admin() {
	return true;
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

class WooCommerce {}

require_once dirname( __DIR__ ) . '/vendor/autoload.php';
require_once dirname( __DIR__ ) . '/moda-interact.php';