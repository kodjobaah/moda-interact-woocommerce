<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Connection\InstallationStore;

/**
 * Local checkout consent-control admission only. A shopper's opt-in is passive
 * evidence, not a request to start recovery or send WhatsApp messages.
 *
 * The hosted consent writer authoritatively authenticates the installation and
 * records the decision. Recovery feature/plan entitlement belongs exclusively
 * to the separate recovery admission and send-time gates.
 */
final class CheckoutConsentEligibility {
	private readonly InstallationStore $installation;
	private ?bool $presentationDecision = null;

	public function __construct( ?InstallationStore $installation = null ) {
		$this->installation = $installation ?? new InstallationStore();
	}

	/**
	 * One local-only decision per page render: no API call or DNS lookup.
	 * Presentation is never authoritative consent evidence.
	 */
	public function eligibleForPresentation(): bool {
		if ( null === $this->presentationDecision ) {
			$this->presentationDecision = $this->locallyConnected();
		}
		return $this->presentationDecision;
	}

	/**
	 * Recheck the local installation and site for every explicit positive action.
	 * Never reuse a memoized page decision and never query feature preferences.
	 * The v2 consent writer performs the final remote installation/tenant check.
	 */
	public function eligible(): bool {
		return $this->locallyConnected();
	}

	private function locallyConnected(): bool {
		try {
			$connection = $this->installation->read();
			if ( 'valid' !== ( $connection['state'] ?? null ) ) {
				CheckoutConsentDiagnostics::warn( 'eligibility_installation_' .
					( 'missing' === ( $connection['state'] ?? null ) ? 'missing' : 'invalid' ) );
				return false;
			}
			// InstallationStore validates the record. Match the local, configured
			// WordPress origin against the bound installation site without DNS.
			// A changed tunnel/host must reconnect before publishing consent.
			$current_url = home_url( '/' );
			if ( ! is_string( $current_url ) || '' === $current_url || strlen( $current_url ) > 512 ||
				rtrim( $current_url, '/' ) !== $connection['record']['canonicalSiteUrl'] ) {
				CheckoutConsentDiagnostics::warn( 'eligibility_site_identity_mismatch' );
				return false;
			}
			return true;
		} catch ( \Throwable $exception ) {
			CheckoutConsentDiagnostics::warn( 'eligibility_local_check_failed', $exception );
			return false;
		}
	}
}
