<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;

/**
 * API-006 proof-backed status, only after a Woo server-held acknowledged GRANT.
 * A phone number, logged-in account or local ACK is never current consent authority.
 */
final class CheckoutConsentStatusReader {
	private $read;

	public function __construct( ?callable $read = null ) {
		$this->read = $read ?? array( $this, 'readHostedStatus' );
	}

	public function confirmed( ?array $proof ): bool {
		return $this->inspect( $proof )['confirmed'];
	}

	/** Keep API-006's UNVERIFIED deliberately opaque (no STOP/revoke detail). */
	public function inspect( ?array $proof ): array {
		if ( null === $proof ) return array( 'confirmed' => false,
			'reason' => 'consent_status_proof_unavailable' );
		try {
			$state = ( $this->read )( $proof );
			if ( 'CONFIRMED_GRANTED' === $state ) return array( 'confirmed' => true, 'reason' => '' );
			$reasons = array(
				'UNVERIFIED' => 'consent_status_remote_unverified',
				'LOCAL_INSTALLATION_UNAVAILABLE' => 'consent_status_installation_unavailable',
				'LOCAL_SITE_MISMATCH' => 'consent_status_site_mismatch',
				'LOCAL_INSTALLATION_CHANGED' => 'consent_status_installation_changed',
			);
			return array( 'confirmed' => false,
				'reason' => $reasons[ $state ] ?? 'consent_status_response_unrecognised' );
		} catch ( \Throwable $error ) {
			// Browser receives a neutral result; internal logs retain a safe event.
			CheckoutConsentDiagnostics::warn( 'status_lookup_failed', $error );
			return array( 'confirmed' => false, 'reason' => 'consent_status_remote_unavailable' );
		}
	}

	private function readHostedStatus( array $proof ): string {
		$installation = new InstallationStore();
		$current = $installation->read();
		if ( 'valid' !== ( $current['state'] ?? null ) ) return 'LOCAL_INSTALLATION_UNAVAILABLE';
		$record = $current['record'];
		$site = new SiteIdentity( ModaApiConfiguration::serverMode() );
		if ( $record['canonicalSiteUrl'] !== $site->currentCanonicalUrl() ) return 'LOCAL_SITE_MISMATCH';
		$api = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration() );
		$status = $api->wooConsentStatus( $record, $proof );
		$after = $installation->read();
		if ( 'valid' !== ( $after['state'] ?? null ) || $after['record'] !== $record ||
			$record['canonicalSiteUrl'] !== $site->currentCanonicalUrl() ) return 'LOCAL_INSTALLATION_CHANGED';
		return $status;
	}
}
