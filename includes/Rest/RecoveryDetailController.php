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

/** Read-only proxy for API-013; only the local installation, never browser input, establishes Shop. */
final class RecoveryDetailController {
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
		$base = '/merchant/recoveries/(?P<recoveryId>[A-Za-z0-9_-]{1,191})';
		foreach ( array( 'summary' => '', 'messages' => '/messages', 'related' => '/related' ) as $section => $suffix ) {
			register_rest_route( 'moda-interact/v1', $base . $suffix, array(
				'methods' => 'GET',
				'callback' => fn( \WP_REST_Request $request ) => $this->read( $request, $section ),
				'permission_callback' => array( $this, 'authorizeAdministrator' ),
			) );
		}
	}

	public function authorizeAdministrator(): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' )
			? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	private static function input( \WP_REST_Request $request, string $section ): ?array {
		$params = $request->get_url_params();
		$id = $params['recoveryId'] ?? null;
		if ( ! is_string( $id ) || ! preg_match( '/^[A-Za-z0-9_-]{1,191}$/D', $id ) ) return null;
		$query = $request->get_query_params();
		if ( array_key_exists( '_locale', $query ) ) {
			if ( 'user' !== $query['_locale'] ) return null;
			unset( $query['_locale'] );
		}
		if ( null !== $request->get_json_params() && array() !== $request->get_json_params() ) return null;
		if ( array() !== $request->get_body_params() ||
			( method_exists( $request, 'get_body' ) && '' !== $request->get_body() ) ) return null;
		if ( 'summary' === $section && $query ) return null;
		foreach ( $query as $key => $value ) {
			if ( ! is_string( $value ) || ! in_array( $key, 'messages' === $section ? array( 'cursor', 'window' ) : array( 'cursor' ), true ) ) return null;
		}
		if ( isset( $query['cursor'] ) && ( ! preg_match( '/^[A-Za-z0-9_-]{1,1024}$/D', $query['cursor'] ) || isset( $query['window'] ) ) ) return null;
		if ( isset( $query['window'] ) && ! in_array( $query['window'], array( 'first', 'latest' ), true ) ) return null;
		return array( $id, $query );
	}

	public function read( \WP_REST_Request $request, string $section = 'summary' ): \WP_REST_Response {
		$input = self::input( $request, $section );
		if ( null === $input ) return self::error( 'INVALID_REQUEST', 400 );
		if ( null === $this->api_client ) return self::error( 'API_NOT_CONFIGURED', 503 );
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) return self::error( 'LOCAL_STATE_INVALID', 409 );
		if ( 'valid' !== $local['state'] ) return self::error( 'RECONNECT_REQUIRED', 401 );
		try {
			$record = $local['record'];
			if ( $this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) return self::error( 'SITE_URL_CHANGED', 409 );
			$data = $this->api_client->merchantRecoveryDetail( $record, $input[0], $section, $input[1] );
			$after = $this->installation_store->read();
			if ( 'valid' !== $after['state'] || $after['record'] !== $record ||
				$this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) return self::error( 'RECONNECT_REQUIRED', 409 );
			return self::respond( $data, 200 );
		} catch ( SiteIdentityException $error ) {
			return self::error( 'SITE_URL_CHANGED', 409 );
		} catch ( ModaApiClientException $error ) {
			$mapping = array(
				'unauthorized' => array( 'RECONNECT_REQUIRED', 401 ),
				'not_found' => array( 'RECOVERY_NOT_FOUND', 404 ),
				'local_state_invalid' => array( 'LOCAL_STATE_INVALID', 409 ),
				'invalid_request' => array( 'INVALID_REQUEST', 400 ),
				'tenant_conflict' => array( 'RECOVERY_UNAVAILABLE', 409 ),
				'remote_response_invalid' => array( 'REMOTE_RESPONSE_INVALID', 502 ),
			);
			$outcome = $mapping[ $error->getMessage() ] ?? array( 'REMOTE_UNAVAILABLE', 503 );
			return self::error( $outcome[0], $outcome[1] );
		} catch ( \Throwable $error ) {
			return self::error( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	private static function error( string $message, int $status ): \WP_REST_Response {
		return self::respond( array( 'status' => $message ), $status );
	}

	private static function respond( array $data, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}
