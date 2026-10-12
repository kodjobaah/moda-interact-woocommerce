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

/** WordPress nonce/capability-protected read proxy; Shop identity comes only from the installation. */
final class RecoveryListController {
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
		register_rest_route( 'moda-interact/v1', '/merchant/recoveries', array(
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

	/** Browser data is strictly filtered and never supplies a Shop or provider identity. */
	private static function filters( \WP_REST_Request $request ): ?array {
		$query = $request->get_query_params();
		if ( array_key_exists( '_locale', $query ) ) {
			if ( 'user' !== $query['_locale'] ) return null;
			unset( $query['_locale'] );
		}
		if ( ( null !== $request->get_json_params() && array() !== $request->get_json_params() ) ||
			array() !== $request->get_body_params() ||
			( method_exists( $request, 'get_body' ) && '' !== $request->get_body() ) ) return null;
		foreach ( $query as $key => $value ) {
			if ( ! in_array( $key, array( 'from', 'to', 'q', 'status', 'page', 'pageSize' ), true ) || ! is_string( $value ) ) return null;
		}
		foreach ( array( 'from', 'to' ) as $date_key ) {
			if ( ! isset( $query[ $date_key ] ) ) continue;
			$date = $query[ $date_key ];
			if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/D', $date ) ||
				! checkdate( (int) substr( $date, 5, 2 ), (int) substr( $date, 8, 2 ), (int) substr( $date, 0, 4 ) ) ) return null;
		}
		if ( isset( $query['from'], $query['to'] ) && $query['from'] > $query['to'] ) return null;
		if ( isset( $query['status'] ) && ! in_array( $query['status'], array( 'all', 'ongoing', 'DETECTED', 'MESSAGE_SENT', 'ENGAGED', 'COMPLETED', 'EXPIRED', 'CANCELLED' ), true ) ) return null;
		if ( isset( $query['q'] ) && ( strlen( $query['q'] ) > 400 ||
			! preg_match( '//u', $query['q'] ) || preg_match( '/[\x00-\x1F\x7F]/', $query['q'] ) ||
			preg_match_all( '/./us', trim( $query['q'] ) ) > 100 ) ) return null;
		if ( isset( $query['page'] ) && ! preg_match( '/^[1-9][0-9]{0,3}$/D', $query['page'] ) ) return null;
		if ( isset( $query['pageSize'] ) && ! in_array( $query['pageSize'], array( '10', '20', '25', '50' ), true ) ) return null;
		return $query;
	}

	public function read( \WP_REST_Request $request ): \WP_REST_Response {
		$filters = self::filters( $request );
		if ( null === $filters ) return self::error( 'INVALID_REQUEST', 400 );
		if ( null === $this->api_client ) return self::error( 'API_NOT_CONFIGURED', 503 );
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) return self::error( 'LOCAL_STATE_INVALID', 409 );
		if ( 'valid' !== $local['state'] ) return self::error( 'RECONNECT_REQUIRED', 401 );
		try {
			$record = $local['record'];
			if ( $this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::error( 'SITE_URL_CHANGED', 409 );
			}
			$data = $this->api_client->merchantRecoveries( $record, $filters );
			$after = $this->installation_store->read();
			if ( 'valid' !== $after['state'] || $after['record'] !== $record ||
				$this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::error( 'RECONNECT_REQUIRED', 409 );
			}
			return self::respond( $data, 200 );
		} catch ( SiteIdentityException $error ) {
			return self::error( 'SITE_URL_CHANGED', 409 );
		} catch ( ModaApiClientException $error ) {
			$mapping = array(
				'unauthorized' => array( 'RECONNECT_REQUIRED', 401 ),
				'local_state_invalid' => array( 'LOCAL_STATE_INVALID', 409 ),
				'invalid_request' => array( 'INVALID_REQUEST', 400 ),
				'tenant_conflict' => array( 'RECOVERIES_UNAVAILABLE', 409 ),
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

	private static function respond( array $payload, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $payload, $status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}
