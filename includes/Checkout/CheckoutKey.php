<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** A cart/session identity, not a WordPress user or Woo customer identifier. */
final class CheckoutKey {
	public const SESSION_FIELD = 'moda_interact_checkout_key';
	public const ORDER_META = '_moda_checkout_key';

	public static function current(): ?string {
		$session = WC()->session ?? null;
		if ( ! $session ) return null;
		$key = $session->get( self::SESSION_FIELD );
		if ( self::valid( $key ) ) return $key;
		$key = 'woo-' . bin2hex( random_bytes( 16 ) );
		$session->set( self::SESSION_FIELD, $key );
		return $key;
	}

	public static function attachToOrder( mixed $order ): void {
		if ( ! is_object( $order ) || ! method_exists( $order, 'get_meta' ) || ! method_exists( $order, 'update_meta_data' ) ) return;
		// HPOS-compatible: the order object owns persistence; never call post-meta APIs.
		if ( self::valid( $order->get_meta( self::ORDER_META, true ) ) ) return;
		$key = self::current();
		if ( null !== $key ) $order->update_meta_data( self::ORDER_META, $key );
	}

	public static function valid( mixed $key ): bool {
		return is_string( $key ) && strlen( $key ) <= 128 && 1 === preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:~-]*$/D', $key );
	}
}
