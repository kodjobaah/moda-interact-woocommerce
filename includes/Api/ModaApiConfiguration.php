<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

final class ModaApiConfiguration {
	public const MODE_PUBLIC = 'public';
	public const MODE_LOCAL_DEVELOPMENT = 'local-development';

	private function __construct(
		public readonly string $base_url,
		public readonly string $mode,
		public readonly ?string $ca_bundle
	) {
	}

	public static function fromServerConfiguration( ?string $base_url = null, ?string $mode = null, ?string $ca_bundle = null ): ?self {
		if ( null === $base_url ) {
			$base_url = defined( 'MODA_INTERACT_API_BASE_URL' )
				? (string) constant( 'MODA_INTERACT_API_BASE_URL' )
				: getenv( 'MODA_INTERACT_API_BASE_URL' );
		}

		if ( false === $base_url || '' === $base_url || null === $base_url ) {
			return null;
		}

		$mode = self::serverMode( $mode );
		if ( null === $ca_bundle ) {
			$ca_bundle = defined( 'MODA_INTERACT_API_CA_BUNDLE' )
				? (string) constant( 'MODA_INTERACT_API_CA_BUNDLE' )
				: getenv( 'MODA_INTERACT_API_CA_BUNDLE' );
		}
		$ca_bundle = false === $ca_bundle || '' === $ca_bundle ? null : $ca_bundle;
		if ( null !== $ca_bundle && ( ! is_file( $ca_bundle ) || ! is_readable( $ca_bundle ) ) ) {
			throw new ModaApiConfigurationException( 'api_not_configured' );
		}

		if ( ! in_array( $mode, array( self::MODE_PUBLIC, self::MODE_LOCAL_DEVELOPMENT ), true ) ) {
			throw new ModaApiConfigurationException( 'api_not_configured' );
		}

		$parts = parse_url( $base_url );
		if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			throw new ModaApiConfigurationException( 'api_not_configured' );
		}

		$scheme   = strtolower( (string) $parts['scheme'] );
		$hostname = strtolower( trim( (string) $parts['host'], '[]' ) );
		$port     = isset( $parts['port'] ) ? (int) $parts['port'] : null;
		if (
			isset( $parts['user'] ) ||
			isset( $parts['pass'] ) ||
			isset( $parts['query'] ) ||
			isset( $parts['fragment'] ) ||
			( isset( $parts['path'] ) && ! in_array( $parts['path'], array( '', '/' ), true ) ) ||
			( null !== $port && ( $port < 1 || $port > 65535 ) )
		) {
			throw new ModaApiConfigurationException( 'api_not_configured' );
		}

		if ( self::MODE_PUBLIC === $mode ) {
			if ( 'https' !== $scheme || false !== filter_var( $hostname, FILTER_VALIDATE_IP ) || ! self::isDnsHostname( $hostname ) ) {
				throw new ModaApiConfigurationException( 'api_not_configured' );
			}
		} elseif ( ! self::isLocalHostname( $hostname ) || ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
			throw new ModaApiConfigurationException( 'api_not_configured' );
		}

		$host = false !== filter_var( $hostname, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6 ) ? '[' . $hostname . ']' : $hostname;
		$url  = $scheme . '://' . $host . ( null !== $port ? ':' . $port : '' );

		return new self( $url, $mode, $ca_bundle );
	}

	public static function serverMode( ?string $mode = null ): string {
		if ( null === $mode ) {
			$mode = defined( 'MODA_INTERACT_CONNECTION_MODE' )
				? (string) constant( 'MODA_INTERACT_CONNECTION_MODE' )
				: getenv( 'MODA_INTERACT_CONNECTION_MODE' );
		}
		$mode = false === $mode || null === $mode || '' === $mode ? self::MODE_PUBLIC : $mode;
		if ( ! in_array( $mode, array( self::MODE_PUBLIC, self::MODE_LOCAL_DEVELOPMENT ), true ) ) {
			throw new ModaApiConfigurationException( 'api_not_configured' );
		}
		return $mode;
	}

	private static function isDnsHostname( string $hostname ): bool {
		if ( '' === $hostname || strlen( $hostname ) > 253 || str_ends_with( $hostname, '.' ) ) {
			return false;
		}

		foreach ( explode( '.', $hostname ) as $label ) {
			if ( strlen( $label ) > 63 || ! preg_match( '/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i', $label ) ) {
				return false;
			}
		}

		return true;
	}

	private static function isLocalHostname( string $hostname ): bool {
		if ( 'localhost' === $hostname || 'host.docker.internal' === $hostname || str_ends_with( $hostname, '.localhost' ) || str_ends_with( $hostname, '.local' ) ) {
			return true;
		}

		if ( filter_var( $hostname, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 ) ) {
			$octets = array_map( 'intval', explode( '.', $hostname ) );
			return 127 === $octets[0] ||
				( 10 === $octets[0] ) ||
				( 172 === $octets[0] && $octets[1] >= 16 && $octets[1] <= 31 ) ||
				( 192 === $octets[0] && 168 === $octets[1] ) ||
				( 169 === $octets[0] && 254 === $octets[1] );
		}

		if ( filter_var( $hostname, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6 ) ) {
			$packed = inet_pton( $hostname );
			return false !== $packed && ( str_starts_with( $packed, str_repeat( "\x00", 15 ) . "\x01" ) ||
				( ord( $packed[0] ) & 0xfe ) === 0xfc ||
				( ord( $packed[0] ) === 0xfe && ( ord( $packed[1] ) & 0xc0 ) === 0x80 ) );
		}

		return false;
	}
}

final class ModaApiConfigurationException extends \RuntimeException {
}