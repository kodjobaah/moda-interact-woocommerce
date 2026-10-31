<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;

/** Synchronous durable-ACK publication and immutable bounded Action Scheduler retry. */
final class CheckoutConsentPublisher {
	public const ACTION = 'moda_interact_dispatch_woo_checkout_consent';
	private const GROUP = 'moda-interact-consent';
	private const MAX_ATTEMPTS = 3;
	private const RETRY_LEASE_PREFIX = 'moda_woo_consent_retry_';

	public function __construct(
		private readonly ?ModaApiClient $api = null,
		private readonly ?InstallationStore $installation = null,
		private readonly ?SiteIdentity $identity = null
	) {}

	public function register(): void {
		add_action( self::ACTION, array( $this, 'deliver' ), 10, 4 );
	}

	/** Returns true ONLY following the hosted PostgreSQL transaction ACK. */
	public function publish( array $event, bool $schedule_on_failure = true ): bool {
		$store = $this->installation ?? new InstallationStore();
		$current = $store->read();
		if ( 'valid' !== $current['state'] ) return false;
		if ( ! $this->installationMatches( $current['record'] ) ) return false;
		return $this->publishFor( $event, $current['record'], 1, $schedule_on_failure );
	}

	/** Action Scheduler has no checkout session: retry only the original, short-lived attested event. */
	public function deliver( array $event, string $installation_id, string $shop_id, int $attempt ): void {
		if ( $attempt < 2 || $attempt > self::MAX_ATTEMPTS ) return;
		$current = ( $this->installation ?? new InstallationStore() )->read();
		if ( 'valid' !== $current['state'] || $current['record']['installationId'] !== $installation_id ||
			$current['record']['shopId'] !== $shop_id || ! $this->installationMatches( $current['record'] ) ||
			! $this->hasRetryLease( $event, $current['record'] ) ) return;
		$this->publishFor( $event, $current['record'], $attempt, true );
	}

	/** Revoke an outstanding background retry when checkout/session/phone identity changes.
	 * The transient stores no customer contact or consent payload.
	 */
	public function cancelPending( array $event ): void {
		if ( function_exists( 'delete_transient' ) && is_string( $event['eventId'] ?? null ) ) {
			delete_transient( self::RETRY_LEASE_PREFIX . hash( 'sha256', $event['eventId'] ) );
		}
	}

	private function hasRetryLease( array $event, array $record ): bool {
		if ( ! is_string( $event['eventId'] ?? null ) || ! function_exists( 'get_transient' ) ) return false;
		$lease = get_transient( self::RETRY_LEASE_PREFIX . hash( 'sha256', $event['eventId'] ) );
		return is_array( $lease ) &&
			( $lease['installationId'] ?? null ) === $record['installationId'] &&
			( $lease['shopId'] ?? null ) === $record['shopId'] &&
			( $lease['credentialVersion'] ?? null ) === $record['credentialVersion'];
	}

	private function installationMatches( array $record ): bool {
		try {
			$identity = $this->identity ?? new SiteIdentity( ModaApiConfiguration::serverMode() );
			return $record['canonicalSiteUrl'] === $identity->currentCanonicalUrl();
		} catch ( \Throwable $error ) {
			CheckoutConsentDiagnostics::warn( 'publisher_installation_check_failed', $error );
			return false;
		}
	}

	private function publishFor( array $event, array $record, int $attempt, bool $retry ): bool {
		if ( ! self::valid( $event ) ) return false;
		$when = strtotime( $event['occurredAt'] );
		if ( false === $when || time() - $when > 240 || $when > time() + 1 ) return false;
		try {
			$client = $this->api ?? new ModaApiClient( ModaApiConfiguration::fromServerConfiguration() );
			$client->publishWooConsent( $record, $event );
			$this->cancelPending( $event );
			return true;
		} catch ( ModaApiClientException $error ) {
			CheckoutConsentDiagnostics::warn( 'consent_publish_rejected', $error );
			// An API contract/conflict rejection is definitive; do not replay over a later REVOKE.
			if ( null !== $error->http_status && $error->http_status >= 400 && $error->http_status < 500 &&
				! in_array( $error->http_status, array( 408, 429 ), true ) ) {
				$this->cancelPending( $event );
				return false;
			}
		} catch ( \Throwable $error ) {
			CheckoutConsentDiagnostics::warn( 'consent_publish_failed', $error );
		}
		if ( $retry && $attempt < self::MAX_ATTEMPTS && function_exists( 'as_schedule_single_action' ) &&
			function_exists( 'set_transient' ) ) {
			try {
				// At most four minutes: a stale page or ended session cannot
				// authorise an unbounded deferred GRANT. Missing lease fails closed.
				if ( true !== set_transient( self::RETRY_LEASE_PREFIX . hash( 'sha256', $event['eventId'] ),
					array( 'installationId' => $record['installationId'], 'shopId' => $record['shopId'],
						'credentialVersion' => $record['credentialVersion'] ), 240 ) ) return false;
				$delay = 1 === $attempt ? 20 : 60;
				as_schedule_single_action( time() + $delay, self::ACTION, array(
				'event' => $event, 'installationId' => $record['installationId'],
				'shopId' => $record['shopId'], 'attempt' => $attempt + 1,
				), self::GROUP, true );
			} catch ( \Throwable $error ) {
				CheckoutConsentDiagnostics::warn( 'consent_retry_schedule_failed', $error );
			}
		}
		return false;
	}

	private static function valid( array $event ): bool {
		if ( array_keys( $event ) !== array( 'schemaVersion', 'eventId', 'decision', 'canonicalPhone', 'occurredAt', 'disclosure' ) ||
			'woo.whatsapp-consent.v2' !== $event['schemaVersion'] || ! CheckoutKey::valid( $event['eventId'] ) ||
			! in_array( $event['decision'], array( 'GRANT', 'REVOKE' ), true ) ||
			! is_string( $event['canonicalPhone'] ) ||
			1 !== preg_match( '/^[1-9][0-9]{1,14}$/D', $event['canonicalPhone'] ) ||
			! is_string( $event['occurredAt'] ) ||
			1 !== preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $event['occurredAt'] ) ||
			false === strtotime( $event['occurredAt'] ) ) return false;
		if ( 'GRANT' === $event['decision'] ) {
			$disclosure = $event['disclosure'];
			if ( ! is_array( $disclosure ) || array_keys( $disclosure ) !== array( 'version', 'locale', 'text' ) ||
				! is_string( $disclosure['version'] ) ||
				1 !== preg_match( '/^moda\.woo\.whatsapp-recovery-marketing\.v[1-9][0-9]*$/D', $disclosure['version'] ) ||
				! is_string( $disclosure['locale'] ) ||
				1 !== preg_match( '/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8}){0,4}$/D', $disclosure['locale'] ) ||
				! is_string( $disclosure['text'] ) || '' === $disclosure['text'] || strlen( $disclosure['text'] ) > 4000 ) return false;
		} elseif ( null !== $event['disclosure'] ) return false;
		$json = wp_json_encode( $event );
		return is_string( $json ) && strlen( $json ) <= 8192;
	}
}
