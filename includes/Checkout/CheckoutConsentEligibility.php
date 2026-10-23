<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\MerchantKnowledgeContracts;
use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;

/**
 * One fresh, installation-authenticated feature read per eligible checkout request.
 * A locally stored credential is not proof that the remote installation is active.
 * Never persist or share this decision across requests: a disabled feature or
 * revoked/reconnected installation must disappear on the next checkout load.
 */
final class CheckoutConsentEligibility {
	private readonly ?ModaApiClient $api;
	private readonly ?SiteIdentity $site;
	private readonly InstallationStore $installation;

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
			$this->site = null;
			$this->api = null;
		}
	}

	public function eligible(): bool {
		if ( null === $this->api || null === $this->site ) return false;
		try {
			$connection = $this->installation->read();
			if ( 'valid' !== $connection['state'] ) return false;
			$record = $connection['record'];
			if ( $record['canonicalSiteUrl'] !== $this->site->currentCanonicalUrl() ) return false;

			$features = $this->api->merchantKnowledgeExchange(
				$record, '/v1/merchant/feature-preferences', 'GET'
			);
			if ( ! MerchantKnowledgeContracts::featureResponse( $features ) ) return false;
			// Fail closed on a malformed/ambiguous feature catalogue.
			$matching = array_values( array_filter( $features['features'],
				static fn( array $row ) => 'checkout_recovery' === $row['key'] ) );
			if ( 1 !== count( $matching ) || true !== $matching[0]['effective'] || true !== $matching[0]['planEligible'] ) {
				return false;
			}
			$after = $this->installation->read();
			return 'valid' === $after['state'] && $record === $after['record'] &&
				$record['canonicalSiteUrl'] === $this->site->currentCanonicalUrl();
		} catch ( \Throwable $exception ) {
			// Checkout itself must not be interrupted by a hosted-API outage.
			return false;
		}
	}
}
