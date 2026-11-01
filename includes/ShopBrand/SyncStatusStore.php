<?php

namespace ModaInteract\WooCommerce\ShopBrand;

defined( 'ABSPATH' ) || exit;

/** Durable, installation-scoped publication evidence for the merchant panel. */
final class SyncStatusStore {
	public const OPTION_NAME = 'moda_interact_shop_brand_sync_status';
	private const STATUSES = array( 'NEVER_SYNCED', 'QUEUED', 'RETRYING', 'ACCEPTED', 'FAILED' );
	private const MAX_CAS_ATTEMPTS = 8;
	private const IN_PROGRESS_TTL = 86400;

	public function read( string $installation_id, string $canonical_site_url ): array {
		$empty = array( 'status' => 'NEVER_SYNCED', 'lastRequestedAt' => null, 'lastAcceptedAt' => null, 'requestId' => null );
		$value = get_option( self::OPTION_NAME, null );
		if ( ! self::valid( $value ) || ! hash_equals( $value['installationKey'], self::key( $installation_id, $canonical_site_url ) ) ) {
			return $empty;
		}
		$visible = array_intersect_key( $value, $empty );
		if ( in_array( $value['status'], array( 'QUEUED', 'RETRYING' ), true ) &&
			strtotime( $value['lastRequestedAt'] ) < time() - self::IN_PROGRESS_TTL ) {
			// Action Scheduler may be deleted or stranded. Never show stale work as active forever.
			$visible['status'] = 'FAILED';
		}
		return $visible;
	}

	/** Begin a new capture generation with a bounded compare-and-swap retry. */
	public function request( string $installation_id, string $canonical_site_url ): ?string {
		$key = self::key( $installation_id, $canonical_site_url );
		$request_id = function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : bin2hex( random_bytes( 16 ) );
		for ( $attempt = 0; $attempt < self::MAX_CAS_ATTEMPTS; ++$attempt ) {
			$stored = $this->loadStored();
			if ( null === $stored ) return null;
			$current = $stored['value'];
			$accepted = self::valid( $current ) && hash_equals( $current['installationKey'], $key )
				? $current['lastAcceptedAt'] : null;
			$record = array(
				'installationKey' => $key,
				'requestId' => $request_id,
				'status' => 'QUEUED',
				'lastRequestedAt' => gmdate( 'Y-m-d\TH:i:s\Z' ),
				'lastAcceptedAt' => $accepted,
			);
			$result = $this->compareAndSwap( $stored['raw'], $record );
			if ( true === $result ) return $request_id;
			if ( null === $result ) return null;
		}
		Publisher::logStatusFailure( 'status_option_cas_exhausted' );
		return null;
	}

	public function retrying( string $request_id, string $installation_id, string $canonical_site_url ): bool {
		return $this->transition( $request_id, $installation_id, $canonical_site_url, 'RETRYING' );
	}

	public function accepted( string $request_id, string $installation_id, string $canonical_site_url ): bool {
		return $this->transition( $request_id, $installation_id, $canonical_site_url, 'ACCEPTED', true );
	}

	public function failed( string $request_id, string $installation_id, string $canonical_site_url ): bool {
		return $this->transition( $request_id, $installation_id, $canonical_site_url, 'FAILED' );
	}

	private function transition( string $request_id, string $installation_id, string $canonical_site_url, string $status, bool $accept = false ): bool {
		$key = self::key( $installation_id, $canonical_site_url );
		for ( $attempt = 0; $attempt < self::MAX_CAS_ATTEMPTS; ++$attempt ) {
			$stored = $this->loadStored();
			if ( null === $stored ) return false;
			$value = $stored['value'];
			if ( ! self::valid( $value ) || ! hash_equals( $value['installationKey'], $key ) ||
				! hash_equals( $value['requestId'], $request_id ) ) {
				return true; // Stale completion: preserve whichever request is current.
			}
			$value['status'] = $status;
			if ( $accept ) $value['lastAcceptedAt'] = gmdate( 'Y-m-d\TH:i:s\Z' );
			$result = $this->compareAndSwap( $stored['raw'], $value );
			if ( true === $result ) return true;
			if ( null === $result ) return false;
		}
		Publisher::logStatusFailure( 'status_option_cas_exhausted' );
		return false;
	}

	/** Read the uncached database value so another PHP worker cannot hide a newer generation. */
	private function loadStored(): ?array {
		global $wpdb;
		if ( ! is_object( $wpdb ) || ! isset( $wpdb->options ) || ! method_exists( $wpdb, 'prepare' ) || ! method_exists( $wpdb, 'get_var' ) ) {
			Publisher::logStatusFailure( 'status_option_store_unavailable' );
			return null;
		}
		try {
			$sql = $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1", self::OPTION_NAME );
			$raw = $wpdb->get_var( $sql );
			if ( false === $raw ) {
				Publisher::logStatusFailure( 'status_option_read_failed' );
				return null;
			}
			return array( 'raw' => null === $raw ? null : (string) $raw, 'value' => null === $raw ? null : maybe_unserialize( $raw ) );
		} catch ( \Throwable $error ) {
			Publisher::logStatusFailure( 'status_option_read_failed' );
			return null;
		}
	}

	/** Atomically replace exactly the option value observed by loadStored(). */
	private function compareAndSwap( ?string $expected_raw, array $value ): ?bool {
		if ( null === $expected_raw ) {
			try {
				$created = add_option( self::OPTION_NAME, $value, '', false );
				return (bool) $created; // A concurrent insert is a retryable conflict.
			} catch ( \Throwable $error ) {
				Publisher::logStatusFailure( 'status_option_write_failed' );
				return null;
			}
		}
		global $wpdb;
		if ( ! is_object( $wpdb ) || ! isset( $wpdb->options ) || ! method_exists( $wpdb, 'prepare' ) || ! method_exists( $wpdb, 'query' ) ) {
			Publisher::logStatusFailure( 'status_option_store_unavailable' );
			return null;
		}
		try {
			$sql = $wpdb->prepare(
				"UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s",
				maybe_serialize( $value ),
				self::OPTION_NAME,
				$expected_raw
			);
			$updated = $wpdb->query( $sql );
			if ( false === $updated ) {
				Publisher::logStatusFailure( 'status_option_write_failed' );
				return null;
			}
			if ( 1 !== $updated ) {
				// Some database drivers report zero rows when the serialized value was already identical.
				$check = $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1", self::OPTION_NAME );
				if ( $wpdb->get_var( $check ) !== maybe_serialize( $value ) ) return false; // Another worker won.
			}
			$this->invalidateOptionCache();
			return true;
		} catch ( \Throwable $error ) {
			Publisher::logStatusFailure( 'status_option_write_failed' );
			return null;
		}
	}

	private function invalidateOptionCache(): void {
		if ( ! function_exists( 'wp_cache_delete' ) ) return;
		wp_cache_delete( self::OPTION_NAME, 'options' );
		// The value is non-autoloaded; clearing alloptions is harmless and protects legacy cache state.
		wp_cache_delete( 'alloptions', 'options' );
	}

	private static function key( string $installation_id, string $canonical_site_url ): string {
		return hash( 'sha256', $installation_id . "\0" . $canonical_site_url );
	}

	private static function valid( mixed $value ): bool {
		return is_array( $value ) && array_keys( $value ) === array( 'installationKey', 'requestId', 'status', 'lastRequestedAt', 'lastAcceptedAt' ) &&
			is_string( $value['installationKey'] ) && preg_match( '/^[a-f0-9]{64}$/D', $value['installationKey'] ) &&
			is_string( $value['requestId'] ) && preg_match( '/^[A-Za-z0-9-]{16,64}$/D', $value['requestId'] ) &&
			in_array( $value['status'], self::STATUSES, true ) && self::timestamp( $value['lastRequestedAt'] ) &&
			( null === $value['lastAcceptedAt'] || self::timestamp( $value['lastAcceptedAt'] ) );
	}

	private static function timestamp( mixed $value ): bool {
		return is_string( $value ) && (bool) preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/D', $value );
	}
}
