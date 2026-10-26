<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Strict woo.activity.v1 checkout projection; no consent or guessed customer identity. */
final class CheckoutSnapshot {
	public static function fromCart( mixed $cart, mixed $customer ): ?array {
		if ( ! is_object( $cart ) || ! method_exists( $cart, 'get_cart' ) || ! method_exists( $cart, 'get_total' ) ) return null;
		$currency = function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : null;
		if ( ! is_string( $currency ) || ! preg_match( '/^[A-Z]{3}$/D', $currency ) ) return null;
		$lines = $cart->get_cart();
		if ( ! is_array( $lines ) ) return null;
		// A verified empty cart is different from unavailable/oversized item data.
		// Woo may still hold its pre-removal total until calculate_totals() runs;
		// calculate_totals() itself skips the after-totals hook for an empty cart.
		if ( array() === $lines ) return array( 'currency' => $currency, 'total' => '0.00', 'items' => array() );
		$total = self::money( $cart->get_total( 'edit' ) );
		if ( null === $total ) return null;
		$snapshot = array( 'currency' => $currency, 'total' => $total );
		// Never publish a misleading *partial* basket if a shop has more than 50 lines.
		if ( count( $lines ) <= 50 ) {
			$items = array();
			foreach ( $lines as $line ) {
				if ( ! is_array( $line ) || ! isset( $line['quantity'] ) || ! is_numeric( $line['quantity'] ) ) return null;
				$qty = (int) $line['quantity'];
				if ( $qty < 1 || $qty > 100000 || (float) $line['quantity'] !== (float) $qty ) return null;
				$item = array( 'quantity' => $qty );
				foreach ( array( 'product_id' => 'productId', 'variation_id' => 'variationId' ) as $source => $target ) {
					if ( ! empty( $line[ $source ] ) && ctype_digit( (string) $line[ $source ] ) ) {
						$item[ $target ] = substr( (string) $line[ $source ], 0, 128 );
					}
				}
				$product = $line['data'] ?? null;
				if ( is_object( $product ) ) {
					if ( method_exists( $product, 'get_sku' ) ) self::putBounded( $item, 'sku', $product->get_sku(), 128 );
					if ( method_exists( $product, 'get_name' ) ) self::putBounded( $item, 'title', $product->get_name(), 200 );
				}
				if ( isset( $line['line_total'] ) ) {
					$line_total = self::money( $line['line_total'] );
					if ( null !== $line_total ) $item['total'] = $line_total;
				}
				if ( isset( $line['line_total'] ) ) {
					$unit_price = self::money( (float) $line['line_total'] / $qty );
					if ( null !== $unit_price ) $item['unitPrice'] = $unit_price;
				}
				$items[] = $item;
			}
			$snapshot['items'] = $items;
		}
		if ( is_object( $customer ) ) {
			$contact = array();
			foreach ( array( 'get_billing_first_name' => 'firstName', 'get_billing_last_name' => 'lastName' ) as $method => $target ) {
				if ( method_exists( $customer, $method ) ) self::putBounded( $contact, $target, $customer->$method(), 100 );
			}
			if ( method_exists( $customer, 'get_billing_email' ) ) {
				$email = $customer->get_billing_email();
				if ( is_string( $email ) && strlen( $email ) <= 254 && filter_var( $email, FILTER_VALIDATE_EMAIL ) ) $contact['email'] = $email;
			}
			if ( method_exists( $customer, 'get_billing_phone' ) ) {
				$phone = $customer->get_billing_phone();
				if ( is_string( $phone ) && preg_match( '/^\+?[0-9 ()-]{5,32}$/D', $phone ) ) $contact['phone'] = $phone;
			}
			if ( $contact ) $snapshot['contact'] = $contact;
		}
		return $snapshot;
	}

	private static function money( mixed $amount ): ?string {
		if ( ! is_numeric( $amount ) || (float) $amount < 0 || ! is_finite( (float) $amount ) ) return null;
		// WC formats monetary amounts as decimals; API contract permits at most two places.
		$value = function_exists( 'wc_format_decimal' ) ? wc_format_decimal( $amount, 2 ) : number_format( (float) $amount, 2, '.', '' );
		return is_string( $value ) && preg_match( '/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/D', $value ) ? $value : null;
	}

	private static function putBounded( array &$target, string $key, mixed $value, int $max ): void {
		if ( ! is_string( $value ) || '' === $value || strlen( $value ) > $max * 4 ) return;
		if ( preg_match_all( '/./us', $value, $characters ) && count( $characters[0] ) <= $max ) $target[ $key ] = $value;
	}
}
