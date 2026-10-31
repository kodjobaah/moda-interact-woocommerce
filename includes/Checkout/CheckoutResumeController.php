<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\WooRestoreResolveResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;

final class CheckoutResumeController {
	private const NONCE_SESSION_FIELD = 'moda_interact_restore_nonce_v1';
	private const COMPLETED_SESSION_FIELD = 'moda_interact_restore_completed_v1';
	private const NONCE_TTL_SECONDS = 900;
	private readonly ?\Closure $resolver;

	public function __construct(
		private readonly CheckoutCapture $capture,
		private readonly CheckoutCartRestorer $restorer,
		private readonly ?InstallationStore $installations = null,
		?callable $resolver = null,
		private readonly ?SiteIdentity $site_identity = null
	) {
		$this->resolver = null === $resolver ? null : \Closure::fromCallable( $resolver );
	}

	public function register(): void {
		add_action( 'template_redirect', array( $this, 'dispatch' ), 0, 0 );
	}

	public function dispatch(): void {
		$uri = (string) ( $_SERVER['REQUEST_URI'] ?? '/' );
		$path = (string) ( parse_url( $uri, PHP_URL_PATH ) ?? '/' );
		$method = strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) );
		$query = isset( $_SERVER['QUERY_STRING'] ) ? self::parseQuery( (string) $_SERVER['QUERY_STRING'] ) : array();
		$result = $this->handleRequest( $method, $path, $query, $_POST, $_SERVER );
		if ( null === $result ) return;
		foreach ( $result['headers'] as $name => $value ) header( $name . ': ' . $value, true );
		if ( isset( $result['redirect'] ) ) {
			wp_safe_redirect( $result['redirect'], $result['status'] );
			exit;
		}
		if ( function_exists( 'status_header' ) ) status_header( $result['status'] );
		if ( 'HEAD' !== $method && '' !== $result['body'] ) echo $result['body'];
		exit;
	}

	/** Small testable dispatcher; a null result means this is an ordinary request. */
	public function handleRequest( string $method, string $path, array $query, array $post, array $server ): ?array {
		if ( ! self::isHomePath( $path ) || ( ! array_key_exists( 'moda_interact_resume', $query ) && ! array_key_exists( 'moda_interact_resume', $post ) ) ) return null;
		$headers = array( 'Cache-Control' => 'no-store', 'Referrer-Policy' => 'no-referrer' );
		if ( 'HEAD' === $method ) return array( 'status' => 200, 'headers' => $headers, 'body' => '' );
		if ( 'GET' === $method ) {
			if ( ! self::validLinkFields( $query ) ) return self::redirect( $headers, self::safeReturnUrl() );
			try {
				$session = self::session();
				if ( ! $session || ! method_exists( $session, 'set' ) ) return self::redirect( $headers, self::safeReturnUrl() );
				$nonce = \ModaInteract\WooCommerce\Security\Base64Url::encode( random_bytes( 32 ) );
				$session->set( self::NONCE_SESSION_FIELD, array( 'digest' => hash( 'sha256', $nonce ), 'issuedAt' => time() ) );
				if ( method_exists( $session, 'set_customer_session_cookie' ) ) $session->set_customer_session_cookie( true );
				return array( 'status' => 200, 'headers' => $headers + array( 'Content-Type' => 'text/html; charset=utf-8' ),
					'body' => self::confirmationPage( $query['r'], $query['t'], $nonce ) );
			} catch ( \Throwable $error ) {
				self::log( 'restore_landing_unavailable', $error );
				return self::redirect( $headers, self::safeReturnUrl() );
			}
		}
		if ( 'POST' !== $method ) return self::redirect( $headers, self::safeReturnUrl() );
		return $this->handlePost( $post, $server, $headers );
	}

	private function handlePost( array $post, array $server, array $headers ): array {
		$content_length = $server['CONTENT_LENGTH'] ?? '0';
		if ( ! self::validPostFields( $post ) || 'replace' !== $post['confirm'] || ! self::sameOrigin( $server ) ||
			! is_string( $content_length ) || ! ctype_digit( $content_length ) || (int) $content_length > 2048 ) return self::redirect( $headers, self::safeReturnUrl() );
		try {
			$session = self::session();
			$evidence = $session ? $session->get( self::NONCE_SESSION_FIELD ) : null;
			$nonce = $post['nonce'];
			if ( ! is_array( $evidence ) || ! is_string( $evidence['digest'] ?? null ) || ! is_int( $evidence['issuedAt'] ?? null ) ||
				$evidence['issuedAt'] > time() || time() - $evidence['issuedAt'] > self::NONCE_TTL_SECONDS ||
				! is_string( $nonce ) || ! preg_match( '/^[A-Za-z0-9_-]{43}$/D', $nonce ) ||
				! hash_equals( $evidence['digest'], hash( 'sha256', $nonce ) ) ) return self::redirect( $headers, self::safeReturnUrl() );
			$prior_session_state = self::snapshotSessionState( $session );
			$session->set( self::NONCE_SESSION_FIELD, null );
			$completed = $session->get( self::COMPLETED_SESSION_FIELD );
			if ( is_array( $completed ) && ( $completed['recoveryId'] ?? null ) === $post['r'] ) {
				return self::redirect( $headers, self::checkoutUrl() );
			}
			$store = $this->installations ?? new InstallationStore();
			$installation = $store->read();
			if ( 'valid' !== ( $installation['state'] ?? null ) ||
				! self::siteMatches( $installation['record'] ) ) return self::redirect( $headers, self::safeReturnUrl() );
			$existing_key = $session->get( CheckoutKey::SESSION_FIELD );
			if ( null !== $existing_key && ! CheckoutKey::valid( $existing_key ) ) {
				return self::redirect( $headers, self::safeReturnUrl() );
			}
			$response = ( $this->resolver ?? self::defaultResolver() )( $installation['record'], $post['r'], $post['t'] );
			$encoded = wp_json_encode( $response );
			$decoded = is_string( $encoded ) ? json_decode( $encoded ) : null;
			if ( ! WooRestoreResolveResponseValidator::isValid( $decoded, $post['r'] ) ||
				'NONE' !== $response['outreachOffer']['kind'] || array() !== $response['snapshot']['appliedCouponCodes'] ) {
				return self::redirect( $headers, self::safeReturnUrl() );
			}
			if ( null !== $existing_key && $existing_key !== $response['checkoutKey'] ) return self::redirect( $headers, self::safeReturnUrl() );
			$restored = $this->restorer->restore( $response['snapshot'], function () use ( $session, $response, $post, $prior_session_state ): bool {
				try {
					$session->set( CheckoutKey::SESSION_FIELD, $response['checkoutKey'] );
					if ( ! $this->capture->captureResumption( $response['checkoutKey'] ) ) throw new \RuntimeException( 'restore_capture_rejected' );
					$session->set( self::COMPLETED_SESSION_FIELD, array( 'recoveryId' => $post['r'], 'completedAt' => time() ) );
					if ( method_exists( $session, 'set_customer_session_cookie' ) ) $session->set_customer_session_cookie( true );
				} catch ( \Throwable $error ) {
					self::log( 'restore_session_commit_failed', $error );
					self::rollbackSessionState( $session, $prior_session_state );
					return false;
				}
				if ( method_exists( $session, 'save_data' ) ) {
					try {
						$session->save_data();
					} catch ( \Throwable $error ) {
						self::log( 'restore_session_persistence_failed', $error );
						self::rollbackSessionState( $session, $prior_session_state );
						return false;
					}
				}
				return true;
			} );
			if ( ! $restored ) return self::redirect( $headers, self::safeReturnUrl() );
			return self::redirect( $headers, self::checkoutUrl() );
		} catch ( \Throwable $error ) {
			self::log( 'restore_confirmation_failed', $error );
			return self::redirect( $headers, self::safeReturnUrl() );
		}
	}

	private static function defaultResolver(): \Closure {
		return static function ( array $connection, string $recovery_id, string $token ): array {
			$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration() );
			return $client->resolveWooRecoveryLink( $connection, $recovery_id, $token );
		};
	}

	private static function confirmationPage( string $recovery_id, string $token, string $nonce ): string {
		$action = self::escapeAttribute( home_url( '/' ) );
		$language = str_replace( '_', '-', (string) get_locale() );
		return '<!doctype html><html lang="' . self::escapeAttribute( $language ) . '"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirm basket replacement</title></head><body><main><h1>Restore your basket?</h1><p>Continuing will replace the items currently in this basket.</p><form method="post" action="' . $action . '"><input type="hidden" name="moda_interact_resume" value="1"><input type="hidden" name="r" value="' . self::escapeAttribute( $recovery_id ) . '"><input type="hidden" name="t" value="' . self::escapeAttribute( $token ) . '"><input type="hidden" name="nonce" value="' . self::escapeAttribute( $nonce ) . '"><button type="submit" name="confirm" value="replace">Replace current basket and continue</button></form></main></body></html>';
	}

	private static function escapeAttribute( string $value ): string {
		return htmlspecialchars( $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
	}

	private static function validLinkFields( array $fields ): bool {
		$keys = array_keys( $fields );
		sort( $keys );
		return array( 'moda_interact_resume', 'r', 't' ) === $keys && '1' === $fields['moda_interact_resume'] &&
			is_string( $fields['r'] ) && 1 === preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/D', $fields['r'] ) &&
			is_string( $fields['t'] ) && 1 === preg_match( '/^[A-Za-z0-9_-]{43}$/D', $fields['t'] );
	}

	private static function validPostFields( array $fields ): bool {
		$keys = array_keys( $fields );
		sort( $keys );
		return array( 'confirm', 'moda_interact_resume', 'nonce', 'r', 't' ) === $keys &&
			'1' === $fields['moda_interact_resume'] && is_string( $fields['r'] ) &&
			1 === preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/D', $fields['r'] ) &&
			is_string( $fields['t'] ) && 1 === preg_match( '/^[A-Za-z0-9_-]{43}$/D', $fields['t'] ) &&
			is_string( $fields['nonce'] ) && 1 === preg_match( '/^[A-Za-z0-9_-]{43}$/D', $fields['nonce'] ) && is_string( $fields['confirm'] );
	}

	private static function parseQuery( string $query ): array {
		if ( strlen( $query ) > 1024 ) return array();
		parse_str( $query, $fields );
		foreach ( array( 'moda_interact_resume', 'r', 't' ) as $key ) {
			if ( 1 !== preg_match_all( '/(?:^|&)' . preg_quote( $key, '/' ) . '=/', $query ) ) return array();
		}
		return is_array( $fields ) ? $fields : array();
	}

	private static function isHomePath( string $path ): bool {
		$home_path = (string) ( parse_url( home_url( '/' ), PHP_URL_PATH ) ?? '/' );
		$home_path = '/' . trim( $home_path, '/' );
		if ( '/' === $home_path ) return '/' === $path;
		return rtrim( $home_path, '/' ) . '/' === $path || rtrim( $home_path, '/' ) === $path;
	}

	private static function sameOrigin( array $server ): bool {
		$origin = $server['HTTP_ORIGIN'] ?? '';
		if ( ! is_string( $origin ) || '' === $origin || false !== strpos( $origin, '/' , 8 ) ) return false;
		$expected = parse_url( home_url( '/' ) );
		$actual = parse_url( $origin );
		return is_array( $expected ) && is_array( $actual ) &&
			strtolower( (string) ( $expected['scheme'] ?? '' ) ) === strtolower( (string) ( $actual['scheme'] ?? '' ) ) &&
			strtolower( (string) ( $expected['host'] ?? '' ) ) === strtolower( (string) ( $actual['host'] ?? '' ) ) &&
			( $expected['port'] ?? null ) === ( $actual['port'] ?? null ) &&
			! isset( $actual['user'] ) && ! isset( $actual['pass'] ) && ! isset( $actual['path'] ) && ! isset( $actual['query'] ) && ! isset( $actual['fragment'] );
	}

	private function siteMatches( array $record ): bool {
		try {
			$identity = $this->site_identity ?? new SiteIdentity( ModaApiConfiguration::serverMode() );
			return $identity->currentCanonicalUrl() === $record['canonicalSiteUrl'];
		} catch ( \Throwable $error ) {
			self::log( 'restore_site_identity_unavailable', $error );
			return false;
		}
	}

	private static function session(): mixed {
		$commerce = function_exists( 'WC' ) ? WC() : null;
		return is_object( $commerce ) ? ( $commerce->session ?? null ) : null;
	}

	private static function snapshotSessionState( mixed $session ): array {
		$state = array();
		foreach ( array( self::NONCE_SESSION_FIELD, CheckoutKey::SESSION_FIELD, self::COMPLETED_SESSION_FIELD, CheckoutCapture::LAST_CAPTURE_SESSION_FIELD ) as $key ) {
			$state[ $key ] = $session->get( $key );
		}
		return $state;
	}

	private static function rollbackSessionState( mixed $session, array $state ): void {
		try {
			foreach ( $state as $key => $value ) $session->set( $key, $value );
			if ( method_exists( $session, 'save_data' ) ) $session->save_data();
		} catch ( \Throwable $error ) {
			self::log( 'restore_session_rollback_failed', $error );
		}
	}

	private static function checkoutUrl(): string {
		return function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : home_url( '/' );
	}

	private static function safeReturnUrl(): string {
		return function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : self::checkoutUrl();
	}

	private static function redirect( array $headers, string $url ): array {
		return array( 'status' => 303, 'headers' => $headers, 'redirect' => $url, 'body' => '' );
	}

	private static function log( string $reason, ?\Throwable $error = null ): void {
		CheckoutDiagnosticLogger::record( 'checkout_restore', $reason, $error );
	}
}