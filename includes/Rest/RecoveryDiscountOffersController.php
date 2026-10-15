<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\DiscountOffersContracts;
use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;

/** WordPress privileged facade. Shop identity comes only from the stored installation. */
final class RecoveryDiscountOffersController {
	private readonly ?ModaApiClient $api_client;
	private readonly SiteIdentity $site_identity;
	private readonly InstallationStore $store;

	public function __construct( ?ModaApiClient $api = null, ?SiteIdentity $identity = null, ?InstallationStore $store = null ) {
		try { $config = ModaApiConfiguration::fromServerConfiguration(); }
		catch ( ModaApiConfigurationException $error ) { $config = null; }
		try { $mode = ModaApiConfiguration::serverMode(); }
		catch ( ModaApiConfigurationException $error ) { $mode = ModaApiConfiguration::MODE_PUBLIC; }
		$this->api_client = $api ?? ( $config ? new ModaApiClient( $config ) : null );
		$this->site_identity = $identity ?? new SiteIdentity( $mode );
		$this->store = $store ?? new InstallationStore();
	}

	public function register(): void { add_action( 'rest_api_init', array( $this, 'registerRoutes' ) ); }

	public function registerRoutes(): void {
		foreach ( array( '/merchant/discount-catalogue' => 'GET', '/merchant/discount-offers' => array( 'GET', 'PUT' ) ) as $route => $methods ) {
			register_rest_route( 'moda-interact/v1', $route, array(
				'methods' => $methods, 'callback' => array( $this, 'handle' ),
				'permission_callback' => array( $this, 'authorizeAdministrator' ),
			) );
		}
	}

	public function authorizeAdministrator( \WP_REST_Request $request ): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' ) &&
			(bool) wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' )
			? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		$route = $request->get_route();
		$catalogue = str_ends_with( $route, '/merchant/discount-catalogue' );
		$offers = str_ends_with( $route, '/merchant/discount-offers' );
		$method = $request->get_method();
		if ( ! $catalogue && ! $offers || $catalogue && 'GET' !== $method ||
			$offers && ! in_array( $method, array( 'GET', 'PUT' ), true ) ) return self::error( 'INVALID_REQUEST', 400 );
		if ( array() !== $request->get_body_params() ||
			( 'PUT' !== $method && null !== $request->get_json_params() ) ) return self::error( 'INVALID_REQUEST', 400 );
		$query = $request->get_query_params();
		unset( $query['_locale'] );
		if ( isset( $request->get_query_params()['_locale'] ) && 'user' !== $request->get_query_params()['_locale'] ) return self::error( 'INVALID_REQUEST', 400 );
		if ( $offers && $query ) return self::error( 'INVALID_REQUEST', 400 );
		if ( $catalogue ) {
			if ( array_diff( array_keys( $query ), array( 'limit', 'cursor', 'search' ) ) ||
				( isset( $query['limit'] ) && ( ! is_scalar( $query['limit'] ) ||
					! preg_match( '/^(?:[1-9]|1\d|2[0-5])$/D', (string) $query['limit'] ) ) ) ||
				( isset( $query['cursor'] ) && ! DiscountOffersContracts::id( $query['cursor'] ) ) ||
				( isset( $query['search'] ) && ( ! is_string( $query['search'] ) || strlen( $query['search'] ) > 80 ||
					preg_match( '/[\x00-\x1f\x7f]/', $query['search'] ) ) ) ) return self::error( 'INVALID_REQUEST', 400 );
			$query['limit'] = isset( $query['limit'] ) ? (int) $query['limit'] : 25;
		}
		$update = null;
		if ( 'PUT' === $method ) {
			if ( ! preg_match( '#^application/json(?:\s*;\s*charset=utf-8)?$#i', (string) $request->get_header( 'Content-Type' ) ) ||
				strlen( (string) $request->get_body() ) > 8192 ) return self::error( 'INVALID_REQUEST', 400 );
			$update = $request->get_json_params();
			if ( ! DiscountOffersContracts::update( $update ) ) return self::error( 'INVALID_REQUEST', 400 );
		}
		if ( null === $this->api_client ) return self::error( 'API_NOT_CONFIGURED', 503 );
		$local = $this->store->read();
		if ( 'invalid' === $local['state'] ) return self::error( 'LOCAL_STATE_INVALID', 409 );
		if ( 'valid' !== $local['state'] ) return self::error( 'RECONNECT_REQUIRED', 401 );
		try {
			$record = $local['record'];
			if ( $this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) return self::error( 'SITE_URL_CHANGED', 409 );
			$data = $catalogue ? $this->api_client->merchantDiscountCatalogue( $record, $query ) :
				$this->api_client->merchantDiscountOffers( $record, $update );
			$after = $this->store->read();
			if ( 'valid' !== $after['state'] || $after['record'] !== $record ||
				$this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) return self::error( 'RECONNECT_REQUIRED', 409 );
			return self::respond( $data, 200 );
		} catch ( SiteIdentityException $error ) { return self::error( 'SITE_URL_CHANGED', 409 ); }
		catch ( ModaApiClientException $error ) {
			$map = array(
				'unauthorized' => array( 'RECONNECT_REQUIRED', 401 ),
				'invalid_request' => array( 'INVALID_REQUEST', 400 ),
				'catalogue_not_current' => array( 'CATALOGUE_NOT_CURRENT', 503 ),
				'offers_conflict' => array( 'OFFERS_CONFLICT', 409 ),
				'selected_coupon_not_found' => array( 'SELECTED_COUPON_NOT_FOUND', 422 ),
				'selection_required' => array( 'SELECTION_REQUIRED', 422 ),
				'selection_limit_exceeded' => array( 'SELECTION_LIMIT_EXCEEDED', 422 ),
				'remote_response_invalid' => array( 'REMOTE_RESPONSE_INVALID', 502 ),
			);
			$outcome = $map[ $error->getMessage() ] ?? array( 'REMOTE_UNAVAILABLE', 503 );
			return self::error( $outcome[0], $outcome[1] );
		} catch ( \Throwable $error ) { return self::error( 'REMOTE_UNAVAILABLE', 503 ); }
	}

	private static function error( string $code, int $status ): \WP_REST_Response { return self::respond( array( 'status' => $code ), $status ); }
	private static function respond( array $body, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $body, $status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}
