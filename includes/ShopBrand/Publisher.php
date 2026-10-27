<?php

namespace ModaInteract\WooCommerce\ShopBrand;

defined( 'ABSPATH' ) || exit;

// The shipped Composer loader is class-map authoritative; new classes are explicit.
require_once __DIR__ . '/SourceReader.php';
require_once __DIR__ . '/SnapshotBuilder.php';

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;

/** Publish complete, immutable source snapshots without an HTTP storefront path. */
final class Publisher {
	public const CAPTURE_ACTION = 'moda_interact_capture_woo_shop_brand';
	public const DELIVERY_ACTION = 'moda_interact_publish_woo_shop_brand';
	private const LEGACY_RECONCILE_ACTION = 'moda_interact_reconcile_woo_shop_brand';
	private const GROUP = 'moda-interact-shop-brand';
	private const BOOTSTRAP_OPTION = 'moda_interact_shop_brand_bootstrapped_installation';
	private const MAX_ATTEMPTS = 5;
	private const RETRY_DELAYS = array( 1 => 20, 2 => 60, 3 => 300, 4 => 900 );

	public function __construct(
		private readonly ?ModaApiClient $api = null,
		private readonly ?InstallationStore $installations = null,
		private readonly ?SiteIdentity $site_identity = null,
		private readonly ?SourceReader $reader = null,
		private readonly ?SnapshotBuilder $builder = null
	) {}

	public function register(): void {
		add_action( self::CAPTURE_ACTION, array( $this, 'capture' ), 10, 2 );
		add_action( self::DELIVERY_ACTION, array( $this, 'deliver' ), 10, 4 );
		add_action( 'action_scheduler_init', array( $this, 'ensureInitialSync' ), 20, 0 );
		// WooCommerce and Action Scheduler may initialize in either order.
		// Never inspect the scheduler store before action_scheduler_init.
		if ( self::schedulerReady() ) {
			$this->ensureInitialSync();
		}
	}

	/**
	 * Capture branding once for an already-connected installation on upgrade.
	 * No recurring reconciliation or automatic WordPress-setting change listeners.
	 */
	public function ensureInitialSync(): void {
		if ( ! self::schedulerReady() ) {
			return;
		}
		$this->removeLegacyReconciliation();
		$local = ( $this->installations ?? new InstallationStore() )->read();
		if ( 'valid' !== $local['state'] ) {
			return; // Plugin may be activated before the store is connected to Moda.
		}
		$installation = $local['record'];
		if ( get_option( self::BOOTSTRAP_OPTION, '' ) === $installation['installationId'] ) {
			return;
		}
		if ( $this->enqueue( $installation ) ) {
			$this->markInitialSyncRequested( $installation['installationId'] );
		}
	}

	/** A new successful connection supplies credentials for its initial sync. */
	public function connected( array $installation ): void {
		// A credential refresh for the same installation is not a brand sync.
		if ( get_option( self::BOOTSTRAP_OPTION, '' ) === ( $installation['installationId'] ?? null ) ) {
			return;
		}
		if ( $this->enqueue( $installation ) ) {
			$this->markInitialSyncRequested( $installation['installationId'] );
		}
	}

	/**
	 * Reusable internal entry point for a future merchant-initiated Sync branding action.
	 * The future WordPress controller must verify capability and nonce before calling it.
	 */
	public function requestSync(): bool {
		return $this->enqueue();
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

	/** Remove schedules created by the previous automatic daily reconciliation design. */
	private function removeLegacyReconciliation(): void {
		if ( ! self::hasScheduled( self::LEGACY_RECONCILE_ACTION, array() ) ) {
			return;
		}
		if ( ! function_exists( 'as_unschedule_all_actions' ) ) {
			self::log( 'legacy_reconcile_cleanup_unavailable' );
			return;
		}
		try {
			as_unschedule_all_actions( self::LEGACY_RECONCILE_ACTION, array(), self::GROUP );
			if ( self::hasScheduled( self::LEGACY_RECONCILE_ACTION, array() ) ) {
				self::log( 'legacy_reconcile_cleanup_failed' );
			}
		} catch ( \Throwable $error ) {
			self::log( 'legacy_reconcile_cleanup_failed' );
		}
	}

	/** Initial and explicit requests coalesce by installation-scoped action identity. */
	private function enqueue( ?array $installation = null ): bool {
		if ( ! self::schedulerReady() || ! function_exists( 'as_enqueue_async_action' ) ) {
			self::log( 'scheduler_unavailable' );
			return false;
		}
		if ( null === $installation ) {
			$local = ( $this->installations ?? new InstallationStore() )->read();
			if ( 'valid' !== $local['state'] ) {
				return false;
			}
			$installation = $local['record'];
		}
		if ( ! InstallationStore::isValidRecord( $installation ) ) {
			return false;
		}
		$args = array( $installation['installationId'], $installation['shopId'] );
		if ( self::hasScheduled( self::CAPTURE_ACTION, $args ) ) {
			return true;
		}
		try {
			$id = as_enqueue_async_action( self::CAPTURE_ACTION, $args, self::GROUP, true );
			if ( self::positiveActionId( $id ) || self::hasScheduled( self::CAPTURE_ACTION, $args ) ) {
				return true;
			}
		} catch ( \Throwable $error ) {
			self::log( 'capture_enqueue_failed' );
			return false;
		}
		self::log( 'capture_enqueue_failed' );
		return false;
	}

	/** Snapshots are captured asynchronously, never during plugin connection or checkout. */
	public function capture( string $installation_id, string $shop_id ): void {
		$installation = $this->currentInstallation( $installation_id, $shop_id );
		if ( null === $installation ) {
			return;
		}
		try {
			$event = ( $this->builder ?? new SnapshotBuilder( $this->reader ) )->capture( $installation_id );
		} catch ( \Throwable $error ) {
			self::log( 'capture_failed' );
			return;
		}
		$this->publish( $installation, $event, 1 );
	}

	/** Retry the exact bytes and observedAt of the first failed observation. */
	public function deliver( array $event, string $installation_id, string $shop_id, int $attempt ): void {
		if ( $attempt < 2 || $attempt > self::MAX_ATTEMPTS || ! SnapshotBuilder::valid( $event ) ) {
			self::log( 'retry_payload_invalid' );
			return;
		}
		$installation = $this->currentInstallation( $installation_id, $shop_id );
		if ( null !== $installation ) {
			$this->publish( $installation, $event, $attempt );
		}
	}

	private function publish( array $installation, array $event, int $attempt ): void {
		try {
			$client = $this->api ?? new ModaApiClient( ModaApiConfiguration::fromServerConfiguration() );
			$client->publishShopBrand( $installation, $event );
			return;
		} catch ( ModaApiClientException $error ) {
			$status = $error->http_status;
			if ( null !== $status && $status >= 400 && $status < 500 && ! in_array( $status, array( 408, 429 ), true ) ) {
				self::log( 'permanent_rejection', $status, $attempt );
				return;
			}
			self::log( 'transient_publish_failure', $status, $attempt );
		} catch ( \Throwable $error ) {
			self::log( 'transient_publish_failure' );
		}
		if ( $attempt >= self::MAX_ATTEMPTS || ! function_exists( 'as_schedule_single_action' ) ) {
			self::log( 'retry_exhausted', null, $attempt );
			return;
		}
		try {
			$id = as_schedule_single_action( time() + self::RETRY_DELAYS[ $attempt ], self::DELIVERY_ACTION,
				array( $event, $installation['installationId'], $installation['shopId'], $attempt + 1 ), self::GROUP, true );
			if ( ! self::positiveActionId( $id ) && ! self::hasScheduled( self::DELIVERY_ACTION,
				array( $event, $installation['installationId'], $installation['shopId'], $attempt + 1 ) ) ) {
				self::log( 'retry_schedule_failed' );
			}
		} catch ( \Throwable $error ) {
			self::log( 'retry_schedule_failed' );
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
}
