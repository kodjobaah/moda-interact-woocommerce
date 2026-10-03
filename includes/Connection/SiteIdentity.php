<?php

namespace ModaInteract\WooCommerce\Connection;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiConfiguration;

final class SiteIdentity {
	private $resolver;

	public function __construct(
		private readonly string $mode,
		?callable $resolver = null
	) {
		$this->resolver = $resolver ?? array( self::class, 'resolveHost' );
	}

	public function currentCanonicalUrl(): string {
		return $this->canonicalize( (string) home_url( '/' ) );
	}

	public function assertConnectionPrerequisites(): string {
		if ( '' === (string) get_option( 'permalink_structure' ) ) {
			throw new SiteIdentityException( 'permalinks_required' );
		}

		$canonical = $this->currentCanonicalUrl();
		$home      = parse_url( $canonical );
		$rest      = parse_url( (string) rest_url( 'moda-interact/v1/connection/challenge' ) );
		if ( ! is_array( $home ) || ! is_array( $rest ) ) {
			throw new SiteIdentityException( 'rest_url_invalid' );
		}

		$expected_path = rtrim( (string) ( $home['path'] ?? '' ), '/' ) . '/wp-json/moda-interact/v1/connection/challenge';
		$rest_host     = strtolower( trim( (string) ( $rest['host'] ?? '' ), '[]' ) );
		$home_host     = strtolower( trim( (string) ( $home['host'] ?? '' ), '[]' ) );
		if (
			strtolower( (string) ( $rest['scheme'] ?? '' ) ) !== strtolower( (string) $home['scheme'] ) ||
			$rest_host !== $home_host ||
			( $rest['port'] ?? null ) !== ( $home['port'] ?? null ) ||
			rtrim( (string) ( $rest['path'] ?? '' ), '/' ) !== $expected_path ||
			isset( $rest['query'] ) ||
			isset( $rest['fragment'] )
		) {
			throw new SiteIdentityException( 'rest_url_invalid' );
		}

		return $canonical;
	}

	public function canonicalize( string $input ): string {
		if ( strlen( $input ) > 512 || str_contains( $input, '?' ) || str_contains( $input, '#' ) ) {
			throw new SiteIdentityException( 'site_url_invalid' );
		}
		$parts = parse_url( $input );
		if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			throw new SiteIdentityException( 'site_url_invalid' );
		}

		$scheme   = strtolower( (string) $parts['scheme'] );
		$hostname = strtolower( rtrim( trim( (string) $parts['host'], '[]' ), '.' ) );
		$port     = isset( $parts['port'] ) ? (int) $parts['port'] : ( 'https' === $scheme ? 443 : 80 );
		if (
			isset( $parts['user'] ) ||
			isset( $parts['pass'] ) ||
			isset( $parts['query'] ) ||
			isset( $parts['fragment'] ) ||
			$port < 1 ||
			$port > 65535 ||
			( 'https' !== $scheme && ( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT !== $this->mode || 'http' !== $scheme ) )
		) {
			throw new SiteIdentityException( 'site_url_invalid' );
		}

		$is_ip = false !== filter_var( $hostname, FILTER_VALIDATE_IP );
		if ( ! $is_ip && ! self::isDnsHostname( $hostname ) ) {
			throw new SiteIdentityException( 'site_url_invalid' );
		}
		if ( ModaApiConfiguration::MODE_PUBLIC === $this->mode && ( 'https' !== $scheme || $is_ip || 443 !== $port ) ) {
			throw new SiteIdentityException( 'site_url_invalid' );
		}

		$this->assertAddressPolicy( $hostname, $scheme, $port, $is_ip );
		$base_path = rtrim( (string) ( $parts['path'] ?? '' ), '/' );
		$host      = false !== filter_var( $hostname, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6 ) ? '[' . $hostname . ']' : $hostname;
		$url       = $scheme . '://' . $host . ( ( 'https' === $scheme && 443 === $port ) || ( 'http' === $scheme && 80 === $port ) ? '' : ':' . $port ) . $base_path;
		if ( strlen( $url ) > 512 ) {
			throw new SiteIdentityException( 'site_url_invalid' );
		}
		return $url;
	}

	public static function resolveHost( string $hostname ): array {
		if ( false !== filter_var( $hostname, FILTER_VALIDATE_IP ) ) {
			return array( $hostname );
		}
		$addresses = gethostbynamel( $hostname );
		foreach ( (array) dns_get_record( $hostname, DNS_AAAA ) as $record ) {
			if ( isset( $record['ipv6'] ) ) {
				$addresses[] = $record['ipv6'];
			}
		}
		return array_values( array_unique( array_filter( (array) $addresses, 'is_string' ) ) );
	}

	private function assertAddressPolicy( string $hostname, string $scheme, int $port, bool $is_ip ): void {
		$answers = ( $this->resolver )( $hostname );
		if ( ! is_array( $answers ) || array() === $answers ) {
			throw new SiteIdentityException( 'site_url_invalid' );
		}
		$local  = array_map( array( self::class, 'isLocalAddress' ), $answers );
		$public = array_map( array( self::class, 'isPublicAddress' ), $answers );
		$all_local  = ! in_array( false, $local, true );
		$all_public = ! in_array( false, $public, true );
		$explicit_local_name = 'localhost' === $hostname || str_ends_with( $hostname, '.localhost' ) || str_ends_with( $hostname, '.local' );

		if ( $all_local ) {
			if ( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT !== $this->mode || ( $is_ip && ! self::isLocalAddress( $hostname ) ) || ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
				throw new SiteIdentityException( 'site_url_invalid' );
			}
			return;
		}

		if ( ! $all_public || $explicit_local_name || 'https' !== $scheme || 443 !== $port || $is_ip ) {
			throw new SiteIdentityException( 'site_url_invalid' );
		}
	}

	private static function isDnsHostname( string $hostname ): bool {
		if ( '' === $hostname || strlen( $hostname ) > 253 ) {
			return false;
		}
		foreach ( explode( '.', $hostname ) as $label ) {
			if ( strlen( $label ) > 63 || ! preg_match( '/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i', $label ) ) {
				return false;
			}
		}
		return true;
	}

	public static function isLocalAddress( string $address ): bool {
		if ( filter_var( $address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 ) ) {
			$octets = array_map( 'intval', explode( '.', $address ) );
			return 127 === $octets[0] || 10 === $octets[0] || ( 172 === $octets[0] && $octets[1] >= 16 && $octets[1] <= 31 ) || ( 192 === $octets[0] && 168 === $octets[1] ) || ( 169 === $octets[0] && 254 === $octets[1] );
		}
		if ( filter_var( $address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6 ) ) {
			$packed = inet_pton( $address );
			return false !== $packed && ( str_starts_with( $packed, str_repeat( "\x00", 15 ) . "\x01" ) || ( ord( $packed[0] ) & 0xfe ) === 0xfc || ( ord( $packed[0] ) === 0xfe && ( ord( $packed[1] ) & 0xc0 ) === 0x80 ) );
		}
		return false;
	}

	public static function isPublicAddress( string $address ): bool {
		return false !== filter_var( $address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE );
	}
}

final class SiteIdentityException extends \RuntimeException {
}