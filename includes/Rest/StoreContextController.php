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
use ModaInteract\WooCommerce\StoreContext\StoreContextResolver;

/** A no-input, administrator-only WordPress command. No tenant values reach the browser. */
final class StoreContextController {
	private readonly ?ModaApiClient $api_client;
	private readonly SiteIdentity $site_identity;
	private readonly InstallationStore $installation_store;
	private readonly StoreContextResolver $resolver;

	public function __construct(
		?ModaApiClient $api_client = null,
		?SiteIdentity $site_identity = null,
		?InstallationStore $installation_store = null,
		?StoreContextResolver $resolver = null
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
		$this->resolver = $resolver ?? new StoreContextResolver();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoutes' ) );
	}

	public function registerRoutes(): void {
		register_rest_route(
			'moda-interact/v1',
			'/merchant/store-context/sync',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'sync' ),
				'permission_callback' => array( $this, 'authorizeAdministrator' ),
			)
		);
	}

	public function authorizeAdministrator(): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' )
			? true
			: new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function sync( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! self::hasNoBusinessInput( $request ) ) {
			return self::result( 'INVALID_REQUEST', 400 );
		}
		if ( ! $this->api_client ) {
			return self::result( 'API_NOT_CONFIGURED', 503 );
		}
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) {
			return self::result( 'LOCAL_STATE_INVALID', 409 );
		}
		if ( 'valid' !== $local['state'] ) {
			return self::result( 'RECONNECT_REQUIRED', 401 );
		}
		try {
			if ( $this->site_identity->currentCanonicalUrl() !== $local['record']['canonicalSiteUrl'] ) {
				return self::result( 'SITE_URL_CHANGED', 409 );
			}
			$this->api_client->putMerchantStoreContext( $local['record'], $this->resolver->resolve() );
			return self::result( 'SYNCED', 200 );
		} catch ( SiteIdentityException $error ) {
			return self::result( 'SITE_URL_CHANGED', 409 );
		} catch ( ModaApiClientException $error ) {
			$mapping = array(
				'unauthorized'           => array( 'RECONNECT_REQUIRED', 401 ),
				'local_state_invalid'    => array( 'LOCAL_STATE_INVALID', 409 ),
				'tenant_conflict'        => array( 'STORE_CONTEXT_CONFLICT', 409 ),
				'remote_rejected'        => array( 'STORE_CONTEXT_REJECTED', 422 ),
				'remote_response_invalid'=> array( 'REMOTE_RESPONSE_INVALID', 502 ),
			);
			$outcome = $mapping[ $error->getMessage() ] ?? array( 'REMOTE_UNAVAILABLE', 503 );
			return self::result( $outcome[0], $outcome[1] );
		} catch ( \Throwable $error ) {
			return self::result( 'STORE_CONTEXT_UNAVAILABLE', 503 );
		}
	}

	private static function hasNoBusinessInput( \WP_REST_Request $request ): bool {
		$query = $request->get_query_params();
		if ( array( '_locale' ) === array_keys( $query ) && 'user' === $query['_locale'] ) {
			$query = array();
		}
		return ( null === $request->get_json_params() || array() === $request->get_json_params() ) &&
			array() === $request->get_body_params() && array() === $query;
	}

	private static function result( string $status, int $http_status ): \WP_REST_Response {
		$response = new \WP_REST_Response( array( 'status' => $status ), $http_status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}
