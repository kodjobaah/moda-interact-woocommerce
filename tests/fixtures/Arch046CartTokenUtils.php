<?php

namespace Automattic\WooCommerce\StoreApi\Utilities;

/** Isolated PHPUnit Store API token stub; production always uses Woo's validator. */
if ( ! class_exists( CartTokenUtils::class, false ) ) {
	class CartTokenUtils {
		public static function get_cart_token( string $customer_id ): string {
			return 'arch046-cart-' . hash( 'sha256', $customer_id );
		}
		public static function validate_cart_token( string $token ): bool {
			$session = function_exists( '\\WC' ) ? \WC()->session : null;
			return $session && method_exists( $session, 'get_customer_id' ) &&
				hash_equals( self::get_cart_token( (string) $session->get_customer_id() ), $token );
		}
	}
}
