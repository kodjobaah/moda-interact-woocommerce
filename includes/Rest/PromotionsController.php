<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Api\PromotionsResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;

/** Non-caching, installation-scoped WP proxy for API-021; no promotion business logic. */
final class PromotionsController {
	private readonly ?ModaApiClient $api;
	private readonly SiteIdentity $site;
	private readonly InstallationStore $store;

	public function __construct( ?ModaApiClient $api = null, ?SiteIdentity $site = null, ?InstallationStore $store = null ) {
		try { $config = ModaApiConfiguration::fromServerConfiguration(); }
		catch ( ModaApiConfigurationException $error ) { $config = null; }
		try { $mode = ModaApiConfiguration::serverMode(); }
		catch ( ModaApiConfigurationException $error ) { $mode = ModaApiConfiguration::MODE_PUBLIC; }
		$this->api = $api ?? ( $config ? new ModaApiClient( $config ) : null );
		$this->site = $site ?? new SiteIdentity( $mode );
		$this->store = $store ?? new InstallationStore();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoutes' ) );
	}

	public function registerRoutes(): void {
		foreach ( array( '/merchant/promotions' => array( 'GET', 'read' ),
			'/merchant/promotions/selection' => array( 'PUT', 'select' ) ) as $path => $route ) {
			register_rest_route( 'moda-interact/v1', $path, array(
				'methods' => $route[0],
				'callback' => array( $this, $route[1] ),
				'permission_callback' => array( $this, 'authorizeAdministrator' ),
			) );
		}
	}

	public function authorizeAdministrator( \WP_REST_Request $request ): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' ) &&
			(bool) wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' )
			? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function read( \WP_REST_Request $request ): \WP_REST_Response {
		if ( true !== $this->authorizeAdministrator( $request ) ) return self::error( 'DENIED', 403 );
		$query = $request->get_query_params();
		if ( array_key_exists( '_locale', $query ) ) {
			if ( 'user' !== $query['_locale'] ) return self::error( 'INVALID_REQUEST', 400 );
			unset( $query['_locale'] );
		}
		foreach ( $query as $key => $value ) {
			if ( ! in_array( $key, array( 'offerPage', 'historyPage' ), true ) || ! is_string( $value ) ||
				! preg_match( '/^[1-9][0-9]{0,3}$/D', $value ) || (int) $value > 1000 ) return self::error( 'INVALID_REQUEST', 400 );
		}
		if ( null !== $request->get_json_params() || array() !== $request->get_body_params() ||
			'' !== $request->get_body() ) return self::error( 'INVALID_REQUEST', 400 );
		$locale = get_user_locale(); // The browser cannot override admin display locale or shop identity.
		$locale = is_string( $locale ) ? str_replace( '_', '-', $locale ) : '';
		if ( strlen( $locale ) > 64 || ! preg_match( '/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/D', $locale ) ) $locale = null;
		return $this->invoke( fn( array $record ) => $this->api->merchantPromotions( $record,
			(int) ( $query['offerPage'] ?? 1 ), (int) ( $query['historyPage'] ?? 1 ), $locale ) );
	}

	public function select( \WP_REST_Request $request ): \WP_REST_Response {
		if ( true !== $this->authorizeAdministrator( $request ) ) return self::error( 'DENIED', 403 );
		$query = $request->get_query_params();
		if ( array( '_locale' ) === array_keys( $query ) && 'user' === $query['_locale'] ) $query = array();
		$type = (string) $request->get_header( 'Content-Type' );
		$body = $request->get_json_params();
		if ( array() !== $query || array() !== $request->get_body_params() ||
			! preg_match( '/^application\/json(?:\s*;\s*charset=utf-8)?$/iD', $type ) ||
			strlen( $request->get_body() ) > 4096 || ! is_array( $body ) || array_is_list( $body ) ||
			count( $body ) !== 2 || ! array_key_exists( 'campaignId', $body ) || ! array_key_exists( 'expectedRevision', $body ) ||
			! is_string( $body['campaignId'] ) || ! preg_match( '/^[A-Za-z0-9_-]{1,128}$/D', $body['campaignId'] ) ||
			! PromotionsResponseValidator::revision( $body['expectedRevision'] ) ) return self::error( 'INVALID_REQUEST', 400 );
		return $this->invoke( fn( array $record ) => $this->api->selectMerchantPromotion( $record,
			$body['campaignId'], $body['expectedRevision'] ) );
	}

	private function invoke( callable $operation ): \WP_REST_Response {
		if ( ! $this->api ) return self::error( 'API_NOT_CONFIGURED', 503 );
		$local = $this->store->read();
		if ( 'invalid' === $local['state'] ) return self::error( 'LOCAL_STATE_INVALID', 409 );
		if ( 'valid' !== $local['state'] ) return self::error( 'RECONNECT_REQUIRED', 401 );
		$record = $local['record'];
		try {
			if ( $this->site->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) return self::error( 'SITE_URL_CHANGED', 409 );
			$result = $operation( $record );
			if ( null !== ( $change = $this->connectionChanged( $record ) ) ) return $change;
			return self::respond( $result, 200 );
		} catch ( SiteIdentityException $error ) {
			return self::error( 'SITE_URL_CHANGED', 409 );
		} catch ( ModaApiClientException $error ) {
			if ( null !== ( $change = $this->connectionChanged( $record ) ) ) return $change;
			if ( 'unauthorized' === $error->getMessage() ) return self::error( 'RECONNECT_REQUIRED', 401 );
			if ( 'invalid_request' === $error->getMessage() ) return self::error( 'INVALID_REQUEST', 400 );
			if ( 'remote_response_invalid' === $error->getMessage() ) return self::error( 'REMOTE_RESPONSE_INVALID', 502 );
			if ( 'local_state_invalid' === $error->getMessage() ) return self::error( 'LOCAL_STATE_INVALID', 409 );
			if ( 'remote_rejected' === $error->getMessage() ) {
				if ( 409 === $error->http_status ) return self::error( 'promotion_revision_conflict' === $error->remote_error ? 'PROMOTION_STALE' : 'PROMOTION_CONFLICT', 409 );
				if ( 422 === $error->http_status ) return self::error( 'PROMOTION_INELIGIBLE', 422 );
				if ( 403 === $error->http_status ) return self::error( 'DENIED', 403 );
			}
			return self::error( 'REMOTE_UNAVAILABLE', 503 );
		} catch ( \Throwable $error ) {
			return self::error( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	/** Re-evaluate before responding, including error responses, after any remote round trip. */
	private function connectionChanged( array $record ): ?\WP_REST_Response {
		$after = $this->store->read();
		if ( 'valid' !== $after['state'] || $after['record'] !== $record ) return self::error( 'RECONNECT_REQUIRED', 409 );
		try {
			if ( $this->site->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) return self::error( 'SITE_URL_CHANGED', 409 );
		} catch ( SiteIdentityException $error ) {
			return self::error( 'SITE_URL_CHANGED', 409 );
		}
		return null;
	}

	private static function error( string $code, int $status ): \WP_REST_Response {
		return self::respond( array( 'status' => $code ), $status );
	}

	private static function respond( array $data, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}
