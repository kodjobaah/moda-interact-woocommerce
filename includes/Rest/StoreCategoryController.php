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
use ModaInteract\WooCommerce\StoreCategory\SelectionInput;

/** Privileged WordPress proxy. Browser inputs never include Shop or installation credentials. */
final class StoreCategoryController {
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
		register_rest_route( 'moda-interact/v1', '/merchant/store-categories', array(
			'methods' => 'GET',
			'callback' => array( $this, 'read' ),
			'permission_callback' => array( $this, 'authorizeAdministrator' ),
		) );
		register_rest_route( 'moda-interact/v1', '/merchant/store-category', array(
			'methods' => 'POST',
			'callback' => array( $this, 'select' ),
			'permission_callback' => array( $this, 'authorizeAdministrator' ),
		) );
	}

	public function authorizeAdministrator(): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' )
			? true
			: new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function read( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! $this->queryAllowed( $request ) || null !== $request->get_json_params() || array() !== $request->get_body_params() ) {
			return self::status( 'INVALID_REQUEST', 400 );
		}
		$locale = get_user_locale();
		if ( ! is_string( $locale ) || strlen( $locale ) > 64 ||
			! preg_match( '/^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{2,8})*$/D', $locale ) ) {
			$locale = 'en_US';
		}
		return $this->invoke( static fn( ModaApiClient $client, array $record ) => $client->merchantStoreCategories( $record, $locale ) );
	}

	public function select( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! $this->queryAllowed( $request ) || array() !== $request->get_body_params() ) {
			return self::status( 'INVALID_REQUEST', 400 );
		}
		$input = SelectionInput::parse( $request->get_json_params() );
		if ( null === $input ) {
			return self::status( 'INVALID_REQUEST', 400 );
		}
		return $this->invoke( static fn( ModaApiClient $client, array $record ) => $client->selectMerchantStoreCategory( $record, $input ) );
	}

	private function invoke( callable $operation ): \WP_REST_Response {
		if ( ! $this->api_client ) {
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
			$data = $operation( $this->api_client, $record );
			// Credential rotation or site move while the remote call was in flight must not expose stale results.
			$after = $this->installation_store->read();
			if ( 'valid' !== $after['state'] || $record !== $after['record'] ||
				$this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::status( 'RECONNECT_REQUIRED', 409 );
			}
			return self::respond( $data, 200 );
		} catch ( SiteIdentityException $error ) {
			return self::status( 'SITE_URL_CHANGED', 409 );
		} catch ( ModaApiClientException $error ) {
			$outcomes = array(
				'unauthorized' => array( 'RECONNECT_REQUIRED', 401 ),
				'local_state_invalid' => array( 'LOCAL_STATE_INVALID', 409 ),
				'tenant_conflict' => array( 'STORE_CATEGORY_CONFLICT', 409 ),
				'category_unavailable' => array( 'CATEGORY_UNAVAILABLE', 422 ),
				'remote_rejected' => array( 'INVALID_REQUEST', 400 ),
				'remote_response_invalid' => array( 'REMOTE_RESPONSE_INVALID', 502 ),
			);
			$outcome = $outcomes[ $error->getMessage() ] ?? array( 'REMOTE_UNAVAILABLE', 503 );
			return self::status( $outcome[0], $outcome[1] );
		} catch ( \Throwable $error ) {
			return self::status( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	private function queryAllowed( \WP_REST_Request $request ): bool {
		$query = $request->get_query_params();
		return array() === $query || ( array( '_locale' ) === array_keys( $query ) && 'user' === $query['_locale'] );
	}

	private static function status( string $status, int $http_status ): \WP_REST_Response {
		return self::respond( array( 'status' => $status ), $http_status );
	}

	private static function respond( array $data, int $http_status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $http_status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}
