<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Strictly bounded API-007 response contract; never pass unknown fields to the browser. */
final class RestReadResponseValidator {
	public static function status( array $payload ): bool {
		return self::hasKeys( $payload, array( 'schemaVersion', 'status', 'providerRevocationRequired' ) ) &&
			1 === $payload['schemaVersion'] &&
			in_array( $payload['status'], array( 'CONNECTED', 'PENDING', 'NOT_CONNECTED', 'REAUTHORIZATION_REQUIRED' ), true ) &&
			is_bool( $payload['providerRevocationRequired'] ) &&
			( 'CONNECTED' !== $payload['status'] || false === $payload['providerRevocationRequired'] );
	}

	public static function revoked( array $payload ): bool {
		return self::hasKeys( $payload, array( 'schemaVersion', 'status', 'providerRevocationRequired' ) ) &&
			1 === $payload['schemaVersion'] && 'REVOKED' === $payload['status'] &&
			true === $payload['providerRevocationRequired'];
	}

	/** The only navigable target is this installation's native Woo authorisation page. */
	public static function start( array $payload, string $site_url, string $connection_mode = ModaApiConfiguration::MODE_PUBLIC ): bool {
		if ( ! self::hasKeys( $payload, array( 'schemaVersion', 'authorizationUrl', 'expiresAt' ) ) ||
			1 !== $payload['schemaVersion'] || ! is_string( $payload['authorizationUrl'] ) ||
			strlen( $payload['authorizationUrl'] ) > 2048 || ! is_string( $payload['expiresAt'] ) ||
			false === strtotime( $payload['expiresAt'] ) ) {
			return false;
		}
		$site = parse_url( $site_url );
		$target = parse_url( $payload['authorizationUrl'] );
		if ( ! is_array( $site ) || ! is_array( $target ) ||
			! isset( $site['scheme'], $site['host'], $target['scheme'], $target['host'], $target['query'] ) ||
			$site['scheme'] !== $target['scheme'] || strcasecmp( $site['host'], $target['host'] ) !== 0 ||
			( $site['port'] ?? null ) !== ( $target['port'] ?? null ) ||
			isset( $target['user'] ) || isset( $target['pass'] ) || isset( $target['fragment'] ) ||
			! in_array( $target['scheme'], array( 'https', 'http' ), true ) ||
			$target['path'] !== rtrim( $site['path'] ?? '', '/' ) . '/wc-auth/v1/authorize' ) {
			return false;
		}
		$parts = explode( '&', $target['query'] );
		if ( count( $parts ) !== 5 ) {
			return false;
		}
		parse_str( $target['query'], $parameters );
		if ( ! self::hasKeys( $parameters, array( 'app_name', 'scope', 'user_id', 'return_url', 'callback_url' ) ) ||
			'Moda Interact' !== $parameters['app_name'] || 'read' !== $parameters['scope'] ||
			! is_string( $parameters['user_id'] ) ||
			! preg_match( '/^[A-Za-z0-9_-]{1,128}$/', $parameters['user_id'] ) ) {
			return false;
		}
		if ( ! is_string( $parameters['return_url'] ) || ! is_string( $parameters['callback_url'] ) ) {
			return false;
		}
		$return = parse_url( $parameters['return_url'] );
		$callback = parse_url( $parameters['callback_url'] );
		$return_query_valid = is_array( $return ) && ! isset( $return['query'] );
		if ( is_array( $return ) && isset( $return['query'] ) ) {
			$parts = explode( '&', $return['query'] );
			parse_str( $return['query'], $presentation );
			$return_query_valid = 2 === count( $parts ) &&
				self::hasKeys( $presentation, array( 'display_locale', 'display_proof' ) ) &&
				is_string( $presentation['display_locale'] ) &&
				1 === preg_match( '/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/D', $presentation['display_locale'] ) &&
				is_string( $presentation['display_proof'] ) &&
				self::validDisplayProof( $presentation['display_proof'] );
		}
		$scheme = is_array( $return ) ? ( $return['scheme'] ?? null ) : null;
		$host = is_array( $return ) ? strtolower( trim( (string) ( $return['host'] ?? '' ), '[]' ) ) : '';
		$approved_origin = 'https' === $scheme ||
			( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT === $connection_mode &&
			'http' === $scheme && in_array( $host, array( 'localhost', '127.0.0.1', '::1' ), true ) );
		return $approved_origin && is_array( $return ) && is_array( $callback ) &&
			( $callback['scheme'] ?? null ) === $scheme &&
			isset( $return['host'], $callback['host'] ) &&
			strcasecmp( $return['host'], $callback['host'] ) === 0 &&
			( $return['port'] ?? null ) === ( $callback['port'] ?? null ) &&
			! isset( $return['user'] ) && ! isset( $callback['user'] ) && ! isset( $return['pass'] ) && ! isset( $callback['pass'] ) &&
			! isset( $return['fragment'] ) && ! isset( $callback['fragment'] ) &&
			$return_query_valid && ! isset( $callback['query'] ) &&
			( $return['path'] ?? '' ) === '/v1/woocommerce/read-authorizations/return' &&
			1 === preg_match( '#^/v1/woocommerce/read-authorizations/callback/[A-Za-z0-9_-]{43}$#', $callback['path'] ?? '' );
	}

	/** API-007 v2 uses five bounded base64url segments; the legacy proof remains accepted. */
	private static function validDisplayProof( string $proof ): bool {
		if ( strlen( $proof ) > 160 ) {
			return false;
		}
		return 1 === preg_match( '/^[A-Za-z0-9_-]{43}$/D', $proof ) ||
			1 === preg_match( '/^v2\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{2,32}\.[A-Za-z0-9_-]{22}$/D', $proof );
	}

	private static function hasKeys( array $payload, array $expected ): bool {
		$keys = array_keys( $payload );
		sort( $keys );
		sort( $expected );
		return $keys === $expected;
	}
}
