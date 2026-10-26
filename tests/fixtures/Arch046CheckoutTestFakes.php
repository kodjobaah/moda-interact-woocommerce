<?php

/** Shared isolated WooCommerce checkout/request stubs for ARCH-046 tests. */

require_once __DIR__ . '/Arch046CartTokenUtils.php';

// WordPress implementations exist in production. Test doubles never expose
// server-held grant capabilities to browser state.
if ( ! function_exists( 'wp_salt' ) ) {
	function wp_salt( $scheme = 'auth' ) { return str_repeat( 'arch046-fixture-secret-', 2 ); }
}
if ( ! function_exists( 'get_user_meta' ) ) {
	function get_user_meta( $user_id, $key, $single = false ) {
		return $GLOBALS['arch046_user_meta'][$user_id][$key] ?? '';
	}
}
if ( ! function_exists( 'update_user_meta' ) ) {
	function update_user_meta( $user_id, $key, $value ) {
		$GLOBALS['arch046_user_meta'][$user_id][$key] = $value;
		return true;
	}
}
if ( ! function_exists( 'delete_user_meta' ) ) {
	function delete_user_meta( $user_id, $key ) {
		unset( $GLOBALS['arch046_user_meta'][$user_id][$key] );
		return true;
	}
}


foreach ( array( 'CheckoutKey', 'CheckoutConsentPhone', 'CheckoutConsentCheckbox', 'CheckoutConsentEligibility', 'CheckoutConsentPublisher', 'CheckoutConsentProof', 'CheckoutConsentStatusReader', 'CheckoutConsentCapture', 'CheckoutConsentActions' ) as $name ) {
	require_once dirname( __DIR__, 2 ) . '/includes/Checkout/' . $name . '.php';
}

if ( ! function_exists( 'WC' ) ) {
	function WC() { return $GLOBALS['arch035_wc']; }
}
if ( ! function_exists( 'wc_load_cart' ) ) {
	function wc_load_cart() {
		$GLOBALS['arch046_wc_load_cart_calls'] = ( $GLOBALS['arch046_wc_load_cart_calls'] ?? 0 ) + 1;
		if ( isset( $GLOBALS['arch046_lazy_checkout_session'] ) ) {
			WC()->session = $GLOBALS['arch046_lazy_checkout_session'];
		}
	}
}
if ( ! function_exists( 'as_schedule_single_action' ) ) {
	function as_schedule_single_action( $timestamp, $hook, $args, $group, $unique ) {
		$GLOBALS['arch035_delayed'][] = compact( 'timestamp', 'hook', 'args', 'group', 'unique' );
		$GLOBALS['arch046_scheduled'][] = compact( 'timestamp', 'hook', 'args', 'group', 'unique' );
		return count( $GLOBALS['arch035_delayed'] );
	}
}

final class Arch046Session {
	public array $items = array();
	public function get( string $key ): mixed { return $this->items[$key] ?? null; }
	public function set( string $key, mixed $value ): void { $this->items[$key] = $value; }
	public function get_customer_id(): string { return $this->items['customer_id'] ?? 'guest-session-1'; }
}
final class Arch046Cart {
	public function get_cart(): array { return array( array( 'product_id' => 1, 'quantity' => 1 ) ); }
}
final class Arch046Customer {
	public string $phone = '+447400123456';
	public string $country = 'GB';
	public function get_billing_phone(): string { return $this->phone; }
	public function get_billing_country(): string { return $this->country; }
}
final class Arch046Countries {
	public function get_allowed_countries(): array { return array( 'GB' => 'United Kingdom', 'US' => 'United States', 'FR' => 'France' ); }
}
final class Arch046CheckoutRequest {
	public function __construct( private array $fields, private string $nonce = 'arch046-fixture-nonce', private string $method = 'PUT', private ?string $cartToken = null ) {}
	public function get_method(): string { return $this->method; }
	public function get_header( $key ): ?string { return strtolower( $key ) === 'nonce' ? $this->nonce : ( strtolower( $key ) === 'cart-token' ? $this->cartToken : null ); }
	public function get_json_params(): array { return array( 'additional_fields' => $this->fields ); }
}
