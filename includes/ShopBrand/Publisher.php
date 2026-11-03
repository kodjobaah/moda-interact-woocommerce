<?php

namespace ModaInteract\WooCommerce\ShopBrand;

defined( 'ABSPATH' ) || exit;

// The shipped Composer loader is class-map authoritative; new classes are explicit.
require_once __DIR__ . '/SourceReader.php';
require_once __DIR__ . '/SnapshotBuilder.php';
require_once __DIR__ . '/SyncStatusStore.php';

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;

/** Publish complete, immutable source snapshots without an HTTP storefront path. */
final class Publisher {
	public const CAPTURE_ACTION = 'moda_interact_capture_woo_shop_brand';
	public const DELIVERY_ACTION = 'moda_interact_publish_woo_shop_brand';
	private const GROUP = 'moda-interact-shop-brand';
	private const BOOTSTRAP_OPTION = 'moda_interact_shop_brand_bootstrapped_installation';
	private const MAX_ATTEMPTS = 5;
	private const RETRY_DELAYS = array( 1 => 20, 2 => 60, 3 => 300, 4 => 900 );

	public function __construct(
		private readonly ?ModaApiClient $api = null,
		private readonly ?InstallationStore $installations = null,
		private readonly ?SiteIdentity $site_identity = null,
		private readonly ?SourceReader $reader = null,
		private readonly ?SnapshotBuilder $builder = null,
		private readonly ?SyncStatusStore $sync_status = null
	) {}

	public function register(): void {
		add_action( self::CAPTURE_ACTION, array( $this, 'capture' ), 10, 3 );
		add_action( self::DELIVERY_ACTION, array( $this, 'deliver' ), 10, 5 );
		add_action( 'action_scheduler_init', array( $this, 'ensureInitialSync' ), 20, 0 );
		// WooCommerce and Action Scheduler may initialize in either order.
		// Never inspect the scheduler store before action_scheduler_init.
		if ( self::schedulerReady() ) {
			$this->ensureInitialSync();
		}
	}

	/**
	 * Capture branding once for an already-connected installation on upgrade.
	 * No recurring reconciliation, automatic WordPress-setting change listeners,
	 * or legacy scheduler migration (this feature has never been deployed).
	 */
	public function ensureInitialSync(): void {
		if ( ! self::schedulerReady() ) {
			return;
		}
		$local = ( $this->installations ?? new InstallationStore() )->read();
		if ( 'valid' !== $local['state'] ) {
			return; // Plugin may be activated before the store is connected to Moda.
		}
		$installation = $local['record'];
		if ( get_option( self::BOOTSTRAP_OPTION, '' ) === $installation['installationId'] ) {
			return;
		}
		if ( null !== $this->enqueue( $installation ) ) {
			$this->markInitialSyncRequested( $installation['installationId'] );
		}
	}

	/** A new successful connection supplies credentials for its initial sync. */
	public function connected( array $installation ): void {
		// A credential refresh for the same installation is not a brand sync.
		if ( get_option( self::BOOTSTRAP_OPTION, '' ) === ( $installation['installationId'] ?? null ) ) {
			return;
		}
		if ( null !== $this->enqueue( $installation ) ) {
			$this->markInitialSyncRequested( $installation['installationId'] );
		}
	}

	/** Reusable internal entry point; the REST boundary must authorize before calling it. */
	public function requestSync(): bool {
		return null !== $this->requestSyncDetailed();
	}

	/** Queue one distinct capture so a later merchant request cannot coalesce away. */
	public function requestSyncDetailed(): ?array {
		$local = ( $this->installations ?? new InstallationStore() )->read();
		if ( 'valid' !== $local['state'] ) return null;
		$installation = $local['record'];
		try {
			if ( ( $this->site_identity ?? new SiteIdentity( ModaApiConfiguration::serverMode() ) )->currentCanonicalUrl() !== $installation['canonicalSiteUrl'] ) return null;
		} catch ( \Throwable $error ) { return null; }
		// Each request gets its own id and Action Scheduler args, preserving the latest requested settings.
		$request_id = $this->enqueue( $installation );
		if ( null === $request_id ) return null;
		return array( 'status' => 'QUEUED' );
	}

	private function markInitialSyncRequested( string $installation_id ): void {
		if ( get_option( self::BOOTSTRAP_OPTION, '' ) === $installation_id ) {
			return;
		}
		if ( ! update_option( self::BOOTSTRAP_OPTION, $installation_id, false ) &&
			get_option( self::BOOTSTRAP_OPTION, '' ) !== $installation_id ) {
			self::log( 'bootstrap_marker_write_failed' );
		}
	}

	/** Initial and explicit captures carry a unique generation to preserve later requests. */
	private function enqueue( ?array $installation = null ): ?string {
		if ( null === $installation ) {
			$local = ( $this->installations ?? new InstallationStore() )->read();
			if ( 'valid' !== $local['state'] ) {
				return null;
			}
			$installation = $local['record'];
		}
		if ( ! InstallationStore::isValidRecord( $installation ) ) {
			return null;
		}
		$store = $this->sync_status ?? new SyncStatusStore();
		$request_id = $store->request( $installation['installationId'], $installation['canonicalSiteUrl'] );
		if ( null === $request_id ) return null;
		if ( ! self::schedulerReady() || ! function_exists( 'as_enqueue_async_action' ) ) {
			self::log( 'scheduler_unavailable' );
			$store->failed( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
			return null;
		}
		$args = array( $installation['installationId'], $installation['shopId'], $request_id );
		try {
			$id = as_enqueue_async_action( self::CAPTURE_ACTION, $args, self::GROUP, true );
			if ( self::positiveActionId( $id ) || self::hasScheduled( self::CAPTURE_ACTION, $args ) ) {
				return $request_id;
			}
		} catch ( \Throwable $error ) {
			self::log( 'capture_enqueue_failed' );
			$store->failed( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
			return null;
		}
		self::log( 'capture_enqueue_failed' );
		$store->failed( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
		return null;
	}

	/** Snapshots are captured asynchronously, never during plugin connection or checkout. */
	public function capture( string $installation_id, string $shop_id, string $request_id = '' ): void {
		$installation = $this->currentInstallation( $installation_id, $shop_id );
		if ( null === $installation ) {
			return;
		}
		if ( '' === $request_id ) {
			$request_id = ( $this->sync_status ?? new SyncStatusStore() )->request( $installation_id, $installation['canonicalSiteUrl'] ) ?? '';
		}
		if ( '' === $request_id ) return;
		try {
			$event = ( $this->builder ?? new SnapshotBuilder( $this->reader ) )->capture( $installation_id );
		} catch ( \Throwable $error ) {
			self::log( 'capture_failed' );
			( $this->sync_status ?? new SyncStatusStore() )->failed( $request_id, $installation_id, $installation['canonicalSiteUrl'] );
			return;
		}
		$this->publish( $installation, $event, 1, $request_id );
	}

	/** Retry the exact bytes and observedAt of the first failed observation. */
	public function deliver( mixed $event, mixed $installation_id, mixed $shop_id, mixed $attempt, mixed $request_id = '' ): void {
		if ( ! is_string( $installation_id ) || '' === $installation_id || ! is_string( $shop_id ) || '' === $shop_id ||
			! is_int( $attempt ) || $attempt < 2 || $attempt > self::MAX_ATTEMPTS || ! is_array( $event ) || ! SnapshotBuilder::valid( $event ) ) {
			self::log( 'retry_payload_invalid' );
			// Terminally settle a correlated malformed action; uncorrelated legacy payloads
			// cannot safely change whichever generation is currently visible.
			if ( is_string( $installation_id ) && '' !== $installation_id && is_string( $shop_id ) && '' !== $shop_id &&
				is_string( $request_id ) && '' !== $request_id ) {
				$installation = $this->currentInstallation( $installation_id, $shop_id );
				if ( null !== $installation ) {
					( $this->sync_status ?? new SyncStatusStore() )->failed( $request_id, $installation_id, $installation['canonicalSiteUrl'] );
				}
			}
			return;
		}
		if ( ! is_string( $request_id ) ) $request_id = '';
		$installation = $this->currentInstallation( $installation_id, $shop_id );
		if ( null !== $installation ) {
			// Legacy retry payloads have no request generation. Deliver their immutable
			// observation, but never let one create or transition the latest status row.
			if ( '' === $request_id ) self::log( 'legacy_retry_uncorrelated' );
			$this->publish( $installation, $event, $attempt, $request_id );
		}
	}

	private function publish( array $installation, array $event, int $attempt, string $request_id ): void {
		$store = $this->sync_status ?? new SyncStatusStore();
		try {
			$client = $this->api ?? new ModaApiClient( ModaApiConfiguration::fromServerConfiguration() );
			$result = $client->publishShopBrand( $installation, $event );
			if ( ! is_array( $result ) || ! in_array( $result['status'] ?? null, array( 'updated', 'unchanged' ), true ) ) {
				$store->failed( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
				self::log( 'remote_response_invalid' );
				return;
			}
			$store->accepted( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
			return;
		} catch ( ModaApiClientException $error ) {
			$status = $error->http_status;
			if ( null !== $status && $status >= 400 && $status < 500 && ! in_array( $status, array( 408, 429 ), true ) ) {
				self::log( 'permanent_rejection', $status, $attempt );
				$store->failed( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
				return;
			}
			self::log( 'transient_publish_failure', $status, $attempt );
		} catch ( \Throwable $error ) {
			self::log( 'transient_publish_failure' );
		}
		if ( $attempt >= self::MAX_ATTEMPTS || ! function_exists( 'as_schedule_single_action' ) ) {
			self::log( 'retry_exhausted', null, $attempt );
			$store->failed( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
			return;
		}
		$store->retrying( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
		try {
			$id = as_schedule_single_action( time() + self::RETRY_DELAYS[ $attempt ], self::DELIVERY_ACTION,
				array( $event, $installation['installationId'], $installation['shopId'], $attempt + 1, $request_id ), self::GROUP, true );
			if ( ! self::positiveActionId( $id ) && ! self::hasScheduled( self::DELIVERY_ACTION,
				array( $event, $installation['installationId'], $installation['shopId'], $attempt + 1, $request_id ) ) ) {
				self::log( 'retry_schedule_failed' );
				$store->failed( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
			}
		} catch ( \Throwable $error ) {
			self::log( 'retry_schedule_failed' );
			$store->failed( $request_id, $installation['installationId'], $installation['canonicalSiteUrl'] );
		}
	}

	private function currentInstallation( string $installation_id, string $shop_id ): ?array {
		$local = ( $this->installations ?? new InstallationStore() )->read();
		if ( 'valid' !== $local['state'] || $local['record']['installationId'] !== $installation_id ||
			$local['record']['shopId'] !== $shop_id ) {
			self::log( 'installation_changed' );
			return null;
		}
		try {
			$identity = $this->site_identity ?? new SiteIdentity( ModaApiConfiguration::serverMode() );
			if ( $identity->currentCanonicalUrl() !== $local['record']['canonicalSiteUrl'] ) {
				self::log( 'site_identity_changed' );
				return null;
			}
		} catch ( \Throwable $error ) {
			self::log( 'site_identity_invalid' );
			return null;
		}
		return $local['record'];
	}

	/** Only action_scheduler_init guarantees an initialized scheduler data store. */
	private static function schedulerReady(): bool {
		// All real WordPress runtimes provide did_action(). PHPUnit uses stubs.
		return ! function_exists( 'did_action' ) || did_action( 'action_scheduler_init' ) > 0;
	}

	private static function hasScheduled( string $hook, array $args ): bool {
		if ( function_exists( 'as_has_scheduled_action' ) ) {
			return (bool) as_has_scheduled_action( $hook, $args, self::GROUP );
		}
		if ( function_exists( 'as_next_scheduled_action' ) ) {
			return false !== as_next_scheduled_action( $hook, $args, self::GROUP );
		}
		return false;
	}

	private static function positiveActionId( mixed $id ): bool {
		return is_numeric( $id ) && (int) $id > 0;
	}

	private static function log( string $reason, ?int $status = null, ?int $attempt = null ): void {
		// WordPress PHP cannot import the Node-only Shared logging entrypoint.
		// Use WooCommerce's configured logger, never exception text, URLs or credentials.
		$context = array( 'source' => 'moda-interact-shop-brand', 'reason' => $reason );
		if ( null !== $status ) {
			$context['http_status'] = $status;
		}
		if ( null !== $attempt ) {
			$context['attempt'] = $attempt;
		}
		try {
			if ( function_exists( 'wc_get_logger' ) ) {
				wc_get_logger()->warning( 'ShopBrand publication: ' . $reason, $context );
				return;
			}
		} catch ( \Throwable $error ) {
			// Diagnostic transport failure must not affect WordPress business operations.
		}
		error_log( 'moda.woocommerce.shop_brand.' . $reason . ( null === $status ? '' : '.' . $status ) );
	}

	public static function logStatusFailure( string $reason ): void { self::log( $reason ); }
}
