<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
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
			// Only this fixed reason reaches the browser. Server-side debug logging
			// distinguishes 404/auth/timeout without exposing the proof or recipient.
			$this->logFailure( $error );
			return array( 'confirmed' => false, 'reason' => 'consent_status_remote_unavailable' );
		}
	}

	private function logFailure( \Throwable $error ): void {
		if ( ! defined( 'WP_DEBUG' ) || true !== WP_DEBUG || ! function_exists( 'wc_get_logger' ) ) return;
		$reason = 'unexpected_failure';
		$status = 0;
		if ( $error instanceof ModaApiClientException ) {
			$allowed = array( 'remote_unavailable', 'remote_rejected',
				'remote_response_invalid', 'invalid_request', 'local_state_invalid' );
			if ( in_array( $error->getMessage(), $allowed, true ) ) $reason = $error->getMessage();
			$status = is_int( $error->http_status ) && $error->http_status >= 100 &&
				$error->http_status <= 599 ? $error->http_status : 0;
		}
		try {
			wc_get_logger()->warning( 'Woo consent status lookup failed', array(
				'source' => 'moda-interact-consent',
				'reason' => $reason,
				'http_status' => $status,
			) );
		} catch ( \Throwable $ignored ) {
			// A failing diagnostic sink must not affect the merchant's checkout.
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
