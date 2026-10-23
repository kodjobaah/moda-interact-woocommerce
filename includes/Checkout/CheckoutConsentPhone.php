<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/**
 * Bounded PHP projection of the published Shared 2.5.0 recipient vectors.
 * Server validation does NOT replace Moda API's libphonenumber-js validation.
 * Unknown national numbering plans fail closed; international input is verified
 * independently by the hosted API against the published canonical contract.
 */
final class CheckoutConsentPhone {
	public static function normalize( mixed $input, ?string $country = null ): ?string {
		if ( ! is_string( $input ) || strlen( $input ) > 64 ) return null;
		$input = trim( $input );
		if ( '' === $input || preg_match( '/(?:ext\.?|extension|x)\s*[0-9]|[#;]/i', $input ) ||
			! preg_match( '/^\+?[0-9() .-]+$/D', $input ) ) return null;
		$digits = preg_replace( '/[^0-9]/', '', $input );
		if ( ! is_string( $digits ) ) return null;
		$international = str_starts_with( $input, '+' );
		if ( ! $international ) {
			if ( null === $country || ! in_array( $country, array( 'GB', 'US', 'FR' ), true ) ) return null;
			if ( 'GB' === $country && preg_match( '/^0[1-9][0-9]{9}$/D', $digits ) ) $digits = '44' . substr( $digits, 1 );
			elseif ( 'US' === $country && preg_match( '/^[2-9][0-9]{2}[2-9][0-9]{6}$/D', $digits ) ) $digits = '1' . $digits;
			elseif ( 'FR' === $country && preg_match( '/^0[1-9][0-9]{8}$/D', $digits ) ) $digits = '33' . substr( $digits, 1 );
			else return null;
		}
		if ( ! preg_match( '/^[1-9][0-9]{7,14}$/D', $digits ) ) return null;
		// Shared fixtures reject the Ofcom UK drama range and invalid country codes.
		if ( preg_match( '/^447700900[0-9]{3}$/D', $digits ) || str_starts_with( $digits, '999' ) ) return null;
		if ( str_starts_with( $digits, '44' ) && strlen( $digits ) !== 12 ) return null;
		if ( str_starts_with( $digits, '1' ) && ( strlen( $digits ) !== 11 || ! preg_match( '/^1[2-9][0-9]{2}[2-9][0-9]{6}$/D', $digits ) ) ) return null;
		if ( str_starts_with( $digits, '33' ) && strlen( $digits ) !== 11 ) return null;
		if ( null !== $country ) {
			$prefix = array( 'GB' => '44', 'US' => '1', 'FR' => '33' )[ $country ] ?? null;
			if ( null === $prefix || ! str_starts_with( $digits, $prefix ) ) return null;
		}
		return $digits;
	}

	/** Only a Woo-validated billing country is suitable for national dialing. */
	public static function verifiedCountry( mixed $value ): ?string {
		if ( ! is_string( $value ) || ! preg_match( '/^[A-Z]{2}$/D', $value ) ) return null;
		$allowed = function_exists( 'WC' ) && is_object( WC()->countries ?? null ) && method_exists( WC()->countries, 'get_allowed_countries' )
			? WC()->countries->get_allowed_countries() : array();
		return is_array( $allowed ) && array_key_exists( $value, $allowed ) ? $value : null;
	}
}
