<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;

/** Read-only, privileged proxy. The browser never submits Shop IDs or credentials. */
final class RecoverySummaryController {
	private readonly ?ModaApiClient $api_client;
	private readonly SiteIdentity $site_identity;
	private readonly InstallationStore $installation_store;

	public function __construct(
		?ModaApiClient $api_client = null,
		?SiteIdentity $site_identity = null,
		?InstallationStore $installation_store = null
	) {
		try {
			$config = ModaApiConfiguration::fromServerConfiguration();
		} catch ( ModaApiConfigurationException $error ) {
			$config = null;
		}
		try {
			$mode = ModaApiConfiguration::serverMode();
		} catch ( ModaApiConfigurationException $error ) {
			$mode = ModaApiConfiguration::MODE_PUBLIC;
		}
		$this->api_client = $api_client ?? ( $config ? new ModaApiClient( $config ) : null );
		$this->site_identity = $site_identity ?? new SiteIdentity( $mode );
		$this->installation_store = $installation_store ?? new InstallationStore();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoutes' ) );
	}

	public function registerRoutes(): void {
		register_rest_route( 'moda-interact/v1', '/merchant/recovery-summary', array(
			'methods' => 'GET',
			'callback' => array( $this, 'read' ),
			'permission_callback' => array( $this, 'authorizeAdministrator' ),
		) );
	}

	public function authorizeAdministrator(): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' )
			? true
			: new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function read( \WP_REST_Request $request ): \WP_REST_Response {
		$query = $request->get_query_params();
		if ( ( array() !== $query && ( array( '_locale' ) !== array_keys( $query ) || 'user' !== $query['_locale'] ) ) ||
			null !== $request->get_json_params() || array() !== $request->get_body_params() ) {
			return self::status( 'INVALID_REQUEST', 400 );
		}
		if ( null === $this->api_client ) {
			return self::status( 'API_NOT_CONFIGURED', 503 );
		}
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) {
			return self::status( 'LOCAL_STATE_INVALID', 409 );
		}
		if ( 'valid' !== $local['state'] ) {
			return self::status( 'RECONNECT_REQUIRED', 401 );
		}
		try {
			$record = $local['record'];
			if ( $this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::status( 'SITE_URL_CHANGED', 409 );
			}
			$summary = $this->api_client->merchantRecoverySummary( $record );
			$after = $this->installation_store->read();
			if ( 'valid' !== $after['state'] || $record !== $after['record'] ||
				$this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::status( 'RECONNECT_REQUIRED', 409 );
			}
			return self::respond( $summary, 200 );
		} catch ( SiteIdentityException $error ) {
			return self::status( 'SITE_URL_CHANGED', 409 );
		} catch ( ModaApiClientException $error ) {
			$mapping = array(
				'unauthorized' => array( 'RECONNECT_REQUIRED', 401 ),
				'local_state_invalid' => array( 'LOCAL_STATE_INVALID', 409 ),
				'tenant_conflict' => array( 'RECOVERY_SUMMARY_UNAVAILABLE', 409 ),
				'remote_response_invalid' => array( 'REMOTE_RESPONSE_INVALID', 502 ),
			);
			$outcome = $mapping[ $error->getMessage() ] ?? array( 'REMOTE_UNAVAILABLE', 503 );
			return self::status( $outcome[0], $outcome[1] );
		} catch ( \Throwable $error ) {
			return self::status( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	private static function status( string $status, int $http_status ): \WP_REST_Response {
		return self::respond( array( 'status' => $status ), $http_status );
	}

	private static function respond( array $data, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}
