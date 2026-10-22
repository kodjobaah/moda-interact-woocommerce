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

/** Same-origin, privileged read; no browser-selected Shop or provider credentials. */
final class UsageHistoryController {
	private readonly ?ModaApiClient $api_client;
	private readonly SiteIdentity $site_identity;
	private readonly InstallationStore $installation_store;

	public function __construct(
		?ModaApiClient $api_client = null,
		?SiteIdentity $site_identity = null,
		?InstallationStore $installation_store = null
	) {
		try { $configuration = ModaApiConfiguration::fromServerConfiguration(); }
		catch ( ModaApiConfigurationException $error ) { $configuration = null; }
		try { $mode = ModaApiConfiguration::serverMode(); }
		catch ( ModaApiConfigurationException $error ) { $mode = ModaApiConfiguration::MODE_PUBLIC; }
		$this->api_client = $api_client ?? ( $configuration ? new ModaApiClient( $configuration ) : null );
		$this->site_identity = $site_identity ?? new SiteIdentity( $mode );
		$this->installation_store = $installation_store ?? new InstallationStore();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoutes' ) );
	}

	public function registerRoutes(): void {
		register_rest_route( 'moda-interact/v1', '/merchant/usage-history', array(
			'methods' => 'GET',
			'callback' => array( $this, 'read' ),
			'permission_callback' => array( $this, 'authorizeAdministrator' ),
		) );
	}

	/** WordPress core REST cookie authentication plus explicit nonce and capability. */
	public function authorizeAdministrator( \WP_REST_Request $request ): bool|\WP_Error {
		if ( ! current_user_can( 'manage_woocommerce' ) ||
			! wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' ) ) {
			return new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
		}
		return true;
	}

	/** Strictly allowlist the API-022 filters. Never forward WordPress-only _locale. */
	private static function filters( \WP_REST_Request $request ): ?array {
		if ( 'GET' !== $request->get_method() ||
			! in_array( $request->get_json_params(), array( null, array() ), true ) ||
			array() !== $request->get_body_params() ||
			( method_exists( $request, 'get_body' ) && '' !== $request->get_body() ) ) return null;
		$filters = $request->get_query_params();
		if ( array_key_exists( '_locale', $filters ) ) {
			if ( 'user' !== $filters['_locale'] ) return null;
			unset( $filters['_locale'] );
		}
		foreach ( $filters as $key => $value ) {
			if ( ! in_array( $key, array( 'view', 'periodId', 'kind', 'page', 'pageSize', 'periodCursor' ), true ) ||
				! is_string( $value ) ) return null;
		}
		if ( isset( $filters['view'] ) && ! in_array( $filters['view'], array( 'current', 'past' ), true ) ) return null;
		if ( isset( $filters['kind'] ) && ! in_array( $filters['kind'], array( 'ALL', 'RECOVERY_CONVERSATION' ), true ) ) return null;
		if ( isset( $filters['periodId'] ) && ! preg_match( '/^[A-Za-z0-9_-]{1,128}$/D', $filters['periodId'] ) ) return null;
		if ( isset( $filters['periodCursor'] ) && ! preg_match( '/^[A-Za-z0-9_-]{1,1024}$/D', $filters['periodCursor'] ) ) return null;
		if ( isset( $filters['page'] ) && ( ! preg_match( '/^[1-9][0-9]{0,3}$/D', $filters['page'] ) || (int) $filters['page'] > 1000 ) ) return null;
		if ( isset( $filters['pageSize'] ) && ! in_array( $filters['pageSize'], array( '10', '25', '50', '100' ), true ) ) return null;
		return $filters;
	}

	public function read( \WP_REST_Request $request ): \WP_REST_Response {
		$filters = self::filters( $request );
		if ( null === $filters ) return self::status( 'INVALID_REQUEST', 400 );
		if ( null === $this->api_client ) return self::status( 'API_NOT_CONFIGURED', 503 );
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) return self::status( 'LOCAL_STATE_INVALID', 409 );
		if ( 'valid' !== $local['state'] ) return self::status( 'RECONNECT_REQUIRED', 401 );
		try {
			$record = $local['record'];
			if ( $this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::status( 'SITE_URL_CHANGED', 409 );
			}
			$history = $this->api_client->merchantUsageHistory( $record, $filters );
			$after = $this->installation_store->read();
			if ( 'valid' !== $after['state'] || $record !== $after['record'] ||
				$this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::status( 'RECONNECT_REQUIRED', 409 );
			}
			return self::respond( $history, 200 );
		} catch ( SiteIdentityException $error ) {
			return self::status( 'SITE_URL_CHANGED', 409 );
		} catch ( ModaApiClientException $error ) {
			$outcome = match ( $error->getMessage() ) {
				'unauthorized' => array( 'RECONNECT_REQUIRED', 401 ),
				'local_state_invalid' => array( 'LOCAL_STATE_INVALID', 409 ),
				'invalid_request' => array( 'INVALID_REQUEST', 400 ),
				'invalid_cursor' => array( 'INVALID_CURSOR', 409 ),
				'invalid_period' => array( 'INVALID_PERIOD', 409 ),
				'permission_denied' => array( 'USAGE_HISTORY_DENIED', 403 ),
				'tenant_conflict' => array( 'RECONNECT_REQUIRED', 409 ),
				'remote_response_invalid' => array( 'REMOTE_RESPONSE_INVALID', 502 ),
				default => array( 'REMOTE_UNAVAILABLE', 503 ),
			};
			return self::status( $outcome[0], $outcome[1] );
		} catch ( \Throwable $error ) {
			return self::status( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	private static function status( string $status, int $code ): \WP_REST_Response {
		return self::respond( array( 'status' => $status ), $code );
	}

	private static function respond( array $data, int $code ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $code );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		$response->header( 'Referrer-Policy', 'no-referrer' );
		return $response;
	}
}
