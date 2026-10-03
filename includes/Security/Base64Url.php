<?php

namespace ModaInteract\WooCommerce\Security;

defined( 'ABSPATH' ) || exit;

final class Base64Url {
	public static function encode( string $bytes ): string {
		return rtrim( strtr( base64_encode( $bytes ), '+/', '-_' ), '=' );
	}

	public static function decode( string $encoded, ?int $expected_bytes = null ): ?string {
		if ( '' === $encoded || ! preg_match( '/^[A-Za-z0-9_-]+$/', $encoded ) ) {
			return null;
		}

		$decoded = base64_decode( strtr( $encoded, '-_', '+/' ) . str_repeat( '=', ( 4 - strlen( $encoded ) % 4 ) % 4 ), true );
		if ( false === $decoded || self::encode( $decoded ) !== $encoded ) {
			return null;
		}
		if ( null !== $expected_bytes && strlen( $decoded ) !== $expected_bytes ) {
			return null;
		}
		return $decoded;
	}
}