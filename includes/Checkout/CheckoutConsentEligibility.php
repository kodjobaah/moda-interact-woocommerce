<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\MerchantKnowledgeContracts;
use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;

/**
 * Separate non-blocking presentation from authoritative consent admission.
 * Checkout UI uses only valid, locally configured installation identity. A
 * locally present credential is NOT evidence of an active plan or consent:
 * eligible() still makes a fresh authenticated feature read for every GRANT.
 */
final class CheckoutConsentEligibility {
	private readonly ?ModaApiClient $api;
	private readonly ?SiteIdentity $site;
	private readonly InstallationStore $installation;
	private ?bool $presentationDecision = null;

	public function __construct(
		?ModaApiClient $api = null,
		?SiteIdentity $site = null,
		?InstallationStore $installation = null
	) {
		$this->installation = $installation ?? new InstallationStore();
		try {
			$this->site = $site ?? new SiteIdentity( ModaApiConfiguration::serverMode() );
			$this->api = $api ?? new ModaApiClient( ModaApiConfiguration::fromServerConfiguration() );
		} catch ( \Throwable $exception ) {
			CheckoutConsentDiagnostics::warn( 'eligibility_configuration_failed', $exception );
			$this->site = null;
			$this->api = null;
		}
	}

	/**
	 * All checkout presentation hooks share one local-only decision per request.
	 * No hosted feature lookup, remote timeout or DNS resolution is permitted on
	 * the rendering path. An unavailable API must not erase the checkbox.
	 * This does not authorise a GRANT, REVOKE or recovery message.
	 */
	public function eligibleForPresentation(): bool {
		if ( null === $this->presentationDecision ) {
			$this->presentationDecision = $this->locallyConfiguredForPresentation();
		}
		return $this->presentationDecision;
	}

	private function locallyConfiguredForPresentation(): bool {
		try {
			$connection = $this->installation->read();
			if ( 'valid' !== ( $connection['state'] ?? null ) ) {
				CheckoutConsentDiagnostics::warn( 'eligibility_installation_' .
					( 'missing' === ( $connection['state'] ?? null ) ? 'missing' : 'invalid' ) );
				return false;
			}
			// InstallationStore validates the canonical URL at connection time.
			// Compare the *configured* WordPress URL without SiteIdentity DNS lookups.
			// Exact comparison deliberately fails closed for changed tunnels/hosts.
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

	/**
	 * Authoritative write gate: never reuse the local presentation decision.
	 * Even if the checkbox was displayed while Moda was unavailable, an inactive,
	 * disabled or plan-ineligible installation cannot produce a new GRANT.
	 */
	public function eligible(): bool {
		if ( null === $this->api || null === $this->site ) {
			CheckoutConsentDiagnostics::warn( 'eligibility_client_unavailable' );
			return false;
		}
		try {
			$connection = $this->installation->read();
			if ( 'valid' !== $connection['state'] ) {
				CheckoutConsentDiagnostics::warn( 'eligibility_installation_' .
					( 'missing' === $connection['state'] ? 'missing' : 'invalid' ) );
				return false;
			}
			$record = $connection['record'];
			if ( $record['canonicalSiteUrl'] !== $this->site->currentCanonicalUrl() ) {
				// Neither host nor credential goes into diagnostics. This is especially
				// useful when a development store changes its tunnel/domain.
				CheckoutConsentDiagnostics::warn( 'eligibility_site_identity_mismatch' );
				return false;
			}

			// Only the optional checkout presentation has this short remote budget.
			// Other merchant-knowledge API requests retain their existing timeout.
			$features = $this->api->merchantKnowledgeExchange(
				$record, '/v1/merchant/feature-preferences', 'GET', null, 2
			);
			if ( ! MerchantKnowledgeContracts::featureResponse( $features ) ) {
				CheckoutConsentDiagnostics::warn( 'eligibility_feature_response_invalid' );
				return false;
			}
			// Fail closed on a malformed/ambiguous feature catalogue.
			$matching = array_values( array_filter( $features['features'],
				static fn( array $row ) => 'checkout_recovery' === $row['key'] ) );
			if ( 1 !== count( $matching ) ) {
				CheckoutConsentDiagnostics::warn( 'eligibility_feature_entry_ambiguous' );
				return false;
			}
			if ( true !== $matching[0]['effective'] ) {
				CheckoutConsentDiagnostics::warn( 'eligibility_feature_disabled' );
				return false;
			}
			if ( true !== $matching[0]['planEligible'] ) {
				CheckoutConsentDiagnostics::warn( 'eligibility_plan_ineligible' );
				return false;
			}
			$after = $this->installation->read();
			$still_current = 'valid' === $after['state'] && $record === $after['record'] &&
				$record['canonicalSiteUrl'] === $this->site->currentCanonicalUrl();
			if ( ! $still_current ) CheckoutConsentDiagnostics::warn( 'eligibility_installation_changed' );
			return $still_current;
		} catch ( \Throwable $exception ) {
			// Never expose upstream failures or impact checkout correctness.
			CheckoutConsentDiagnostics::warn( 'eligibility_lookup_failed', $exception );
			return false;
		}
	}
}
