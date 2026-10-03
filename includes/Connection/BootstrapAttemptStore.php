<?php

namespace ModaInteract\WooCommerce\Connection;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Security\Base64Url;

final class BootstrapAttemptStore {
	public const TTL_SECONDS = 120;
	private const TRANSIENT_PREFIX = 'moda_interact_bootstrap_';
	private const LOCK_PREFIX = 'moda_interact_challenge_lock_';

	public function __construct() {
		add_action( 'moda_interact_expire_challenge_lock', array( $this, 'expireChallengeLock' ), 10, 2 );
	}

	public function create( string $attempt_id, string $secret, string $canonical_site_url ): bool {
		if ( null === Base64Url::decode( $secret, 32 ) || ! self::isUuid( $attempt_id ) ) {
			return false;
		}

		$expires_at = time() + self::TTL_SECONDS;
		return set_transient(
			self::transientKey( $attempt_id ),
			array(
				'attemptId'       => $attempt_id,
				'bootstrapSecret' => $secret,
				'canonicalSiteUrl'=> $canonical_site_url,
				'expiresAt'       => $expires_at,
			),
			self::TTL_SECONDS
		);
	}

	public function consume( string $attempt_id ): ?array {
		if ( ! self::isUuid( $attempt_id ) ) {
			return null;
		}

		$key     = self::transientKey( $attempt_id );
		$attempt = get_transient( $key );
		if ( ! self::isValidAttempt( $attempt, $attempt_id ) ) {
			delete_transient( $key );
			return null;
		}

		$lock_key  = self::lockKey( $attempt_id );
		$expires_at = (int) $attempt['expiresAt'];
		if ( ! add_option( $lock_key, $expires_at, '', false ) ) {
			return null;
		}
		if ( ! wp_next_scheduled( 'moda_interact_expire_challenge_lock', array( $lock_key, $expires_at ) ) ) {
			wp_schedule_single_event( $expires_at, 'moda_interact_expire_challenge_lock', array( $lock_key, $expires_at ) );
		}

		$attempt = get_transient( $key );
		if ( ! self::isValidAttempt( $attempt, $attempt_id ) || ! delete_transient( $key ) ) {
			return null;
		}
		return $attempt;
	}

	public function remove( string $attempt_id ): void {
		if ( self::isUuid( $attempt_id ) ) {
			delete_transient( self::transientKey( $attempt_id ) );
		}
	}

	public function expireChallengeLock( string $lock_key, int $expires_at ): void {
		if ( str_starts_with( $lock_key, self::LOCK_PREFIX ) && $expires_at <= time() && (int) get_option( $lock_key, 0 ) <= time() ) {
			delete_option( $lock_key );
		}
	}

	private static function isValidAttempt( mixed $attempt, string $attempt_id ): bool {
		return is_array( $attempt ) &&
			array_keys( $attempt ) === array( 'attemptId', 'bootstrapSecret', 'canonicalSiteUrl', 'expiresAt' ) &&
			$attempt['attemptId'] === $attempt_id &&
			is_string( $attempt['bootstrapSecret'] ) &&
			null !== Base64Url::decode( $attempt['bootstrapSecret'], 32 ) &&
			is_string( $attempt['canonicalSiteUrl'] ) &&
			is_int( $attempt['expiresAt'] ) &&
			$attempt['expiresAt'] > time();
	}

	private static function isUuid( string $value ): bool {
		return (bool) preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value );
	}

	private static function transientKey( string $attempt_id ): string {
		return self::TRANSIENT_PREFIX . hash( 'sha256', $attempt_id );
	}

	private static function lockKey( string $attempt_id ): string {
		return self::LOCK_PREFIX . hash( 'sha256', $attempt_id );
	}
}