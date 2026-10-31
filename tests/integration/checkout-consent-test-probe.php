<?php
/**
 * Disposable wp-env-only ARCH-046 checkout diagnostic.
 *
 * The consent integration runner temporarily copies this file to mu-plugins,
 * then deletes it in finally. It is not part of the installed Moda runtime.
 * Never emit checkout HTML, cookies, nonces, phone numbers or session IDs.
 */

defined( 'ABSPATH' ) || exit;

$GLOBALS['moda_arch046_shortcode_entered'] = false;
$GLOBALS['moda_arch046_form_hook_entered'] = false;
$GLOBALS['moda_arch046_post_content_seen'] = false;
$GLOBALS['moda_arch046_shortcode_callback_seen'] = false;
$GLOBALS['moda_arch046_shortcode_output_seen'] = false;

// Observe whether WordPress attempts to render the queried page's content.
// Do not change the content, registered shortcode callback or return values.
add_filter( 'the_content', static function ( $content ) {
	if ( get_the_ID() === get_queried_object_id() ) {
		$GLOBALS['moda_arch046_post_content_seen'] = true;
	}
	return $content;
}, 9 );

add_filter( 'pre_do_shortcode_tag', static function ( $return, $tag ) {
	if ( $tag === 'woocommerce_checkout' ) {
		$GLOBALS['moda_arch046_shortcode_callback_seen'] = true;
	}
	return $return;
}, 10, 2 );

add_filter( 'do_shortcode_tag', static function ( $output, $tag ) {
	if ( $tag === 'woocommerce_checkout' ) {
		$GLOBALS['moda_arch046_shortcode_output_seen'] = true;
	}
	return $output;
}, 10, 2 );

add_action( 'woocommerce_before_checkout_form_cart_notices', static function (): void {
	$GLOBALS['moda_arch046_shortcode_entered'] = true;
}, 1 );

add_action( 'woocommerce_before_checkout_form', static function (): void {
	$GLOBALS['moda_arch046_form_hook_entered'] = true;
}, 1 );

add_action( 'wp_footer', static function (): void {
	// The probe only responds to the integration runner's explicit test header.
	if ( ( $_SERVER['HTTP_X_MODA_ARCH046_TEST_PROBE'] ?? '' ) !== '1' ||
		! function_exists( 'is_checkout' ) || ! is_checkout() ) {
		return;
	}

	$cart = function_exists( 'WC' ) ? WC()->cart : null;
	$cart_loaded = $cart instanceof \WC_Cart;
	$page = get_queried_object();
	$has_shortcode = $page instanceof \WP_Post &&
		is_string( $page->post_content ) &&
		function_exists( 'has_shortcode' ) && has_shortcode( $page->post_content, 'woocommerce_checkout' );

	$signals = array(
		'phpCartLoaded' => $cart_loaded,
		'phpCartCount' => $cart_loaded ? (int) $cart->get_cart_contents_count() : null,
		'hasClassicShortcode' => (bool) $has_shortcode,
		'comingSoonEnabled' => get_option( 'woocommerce_coming_soon', 'no' ) === 'yes',
		'shortcodeRegistered' => function_exists( 'shortcode_exists' ) && shortcode_exists( 'woocommerce_checkout' ),
		'postContentFilterReached' => (bool) $GLOBALS['moda_arch046_post_content_seen'],
		'shortcodeCallbackReached' => (bool) $GLOBALS['moda_arch046_shortcode_callback_seen'],
		'shortcodeOutputProduced' => (bool) $GLOBALS['moda_arch046_shortcode_output_seen'],
		'shortcodeEntered' => (bool) $GLOBALS['moda_arch046_shortcode_entered'],
		'beforeFormHookEntered' => (bool) $GLOBALS['moda_arch046_form_hook_entered'],
	);

	// Fixed-shape, bounded, non-sensitive flags only.
	echo "\n<!-- MODA_ARCH046_CONSENT_PROBE " . wp_json_encode( $signals ) . " -->\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}, PHP_INT_MAX );
