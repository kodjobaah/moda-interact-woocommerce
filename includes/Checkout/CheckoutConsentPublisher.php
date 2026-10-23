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
			$current['record']['shopId'] !== $shop_id || ! $this->installationMatches( $current['record'] ) ) return;
		$this->publishFor( $event, $current['record'], $attempt, true );
	}

	private function installationMatches( array $record ): bool {
		try {
			$identity = $this->identity ?? new SiteIdentity( ModaApiConfiguration::serverMode() );
			return $record['canonicalSiteUrl'] === $identity->currentCanonicalUrl();
		} catch ( \Throwable $error ) { return false; }
	}

	private function publishFor( array $event, array $record, int $attempt, bool $retry ): bool {
		if ( ! self::valid( $event ) ) return false;
		$when = strtotime( $event['checkoutAction']['occurredAt'] );
		if ( false === $when || time() - $when > 240 || $when > time() + 1 ) return false;
		try {
			$client = $this->api ?? new ModaApiClient( ModaApiConfiguration::fromServerConfiguration() );
			$client->publishWooConsent( $record, $event );
			return true;
		} catch ( ModaApiClientException $error ) {
			// An API contract/conflict rejection is definitive; do not replay over a later REVOKE.
			if ( null !== $error->http_status && $error->http_status >= 400 && $error->http_status < 500 &&
				! in_array( $error->http_status, array( 408, 429 ), true ) ) return false;
		} catch ( \Throwable $error ) { /* Checkout stays usable, with no claimed ACK. */ }
		if ( $retry && $attempt < self::MAX_ATTEMPTS && function_exists( 'as_schedule_single_action' ) ) {
			try {
				$delay = 1 === $attempt ? 20 : 60;
				as_schedule_single_action( time() + $delay, self::ACTION, array(
				'event' => $event, 'installationId' => $record['installationId'],
				'shopId' => $record['shopId'], 'attempt' => $attempt + 1,
				), self::GROUP, true );
			} catch ( \Throwable $error ) { /* No customer PII in diagnostic logs. */ }
		}
		return false;
	}

	private static function valid( array $event ): bool {
		return ( $event['schemaVersion'] ?? null ) === 'woo.whatsapp-consent.v1' &&
			CheckoutKey::valid( $event['eventId'] ?? null ) && CheckoutKey::valid( $event['checkoutAction']['checkoutKey'] ?? null ) &&
			in_array( $event['decision'] ?? null, array( 'GRANT', 'REVOKE' ), true ) &&
			isset( $event['canonicalPhone'] ) && is_string( $event['canonicalPhone'] ) &&
			1 === preg_match( '/^[1-9][0-9]{1,14}$/D', $event['canonicalPhone'] ) &&
			is_string( $event['checkoutAction']['occurredAt'] ?? null ) &&
			is_string( wp_json_encode( $event ) ) && strlen( wp_json_encode( $event ) ) <= 8192;
	}
}
