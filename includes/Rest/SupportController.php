<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Api\SupportResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;

/** Browser -> privileged WP REST -> installation-authenticated hosted Support. */
final class SupportController {
	private readonly ?ModaApiClient $api_client;
	private readonly SiteIdentity $site_identity;
	private readonly InstallationStore $installation_store;

	public function __construct( ?ModaApiClient $api_client = null, ?SiteIdentity $site_identity = null,
		?InstallationStore $installation_store = null ) {
		try { $config = ModaApiConfiguration::fromServerConfiguration(); }
		catch ( ModaApiConfigurationException $error ) { $config = null; }
		try { $mode = ModaApiConfiguration::serverMode(); }
		catch ( ModaApiConfigurationException $error ) { $mode = ModaApiConfiguration::MODE_PUBLIC; }
		$this->api_client = $api_client ?? ( $config ? new ModaApiClient( $config ) : null );
		$this->site_identity = $site_identity ?? new SiteIdentity( $mode );
		$this->installation_store = $installation_store ?? new InstallationStore();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoutes' ) );
	}

	public function registerRoutes(): void {
		register_rest_route( 'moda-interact/v1', '/merchant/support/messages', array(
			array( 'methods' => 'GET', 'callback' => array( $this, 'history' ),
				'permission_callback' => array( $this, 'authorizeAdministrator' ) ),
			array( 'methods' => 'POST', 'callback' => array( $this, 'compose' ),
				'permission_callback' => array( $this, 'authorizeAdministrator' ) ),
		) );
		register_rest_route( 'moda-interact/v1', '/merchant/support/messages/(?P<messageId>[A-Za-z0-9_-]{1,191})/read', array(
			'methods' => 'POST', 'callback' => array( $this, 'markRead' ),
			'permission_callback' => array( $this, 'authorizeAdministrator' ),
		) );
	}

	public function authorizeAdministrator( \WP_REST_Request $request ): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' ) &&
			(bool) wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' )
			? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function history( \WP_REST_Request $request ): \WP_REST_Response {
		if ( true !== $this->authorizeAdministrator( $request ) ) return self::error( 'FORBIDDEN', 403 );
		if ( 'GET' !== $request->get_method() || ! self::bodyEmpty( $request ) ) return self::error( 'INVALID_REQUEST', 400 );
		$query = $request->get_query_params();
		if ( ! self::queryAllowed( $query, array( 'page', 'pageSize' ) ) ) return self::error( 'INVALID_REQUEST', 400 );
		$page = $query['page'] ?? '1';
		$size = $query['pageSize'] ?? '25';
		if ( ! is_scalar( $page ) || ! preg_match( '/^[1-9][0-9]{0,5}$/D', (string) $page ) ||
			! is_scalar( $size ) || ! in_array( (string) $size, array( '10', '25', '50' ), true ) ) {
			return self::error( 'INVALID_REQUEST', 400 );
		}
		return $this->forward( static fn( ModaApiClient $client, array $connection ) =>
			$client->merchantSupportHistory( $connection, (int) $page, (int) $size ) );
	}

	public function compose( \WP_REST_Request $request ): \WP_REST_Response {
		if ( true !== $this->authorizeAdministrator( $request ) ) return self::error( 'FORBIDDEN', 403 );
		if ( 'POST' !== $request->get_method() || ! self::queryAllowed( $request->get_query_params() ) ||
			array() !== $request->get_body_params() || array() !== $request->get_file_params() ||
			! self::jsonHeader( $request ) || ! SupportResponseValidator::composeInput( $request->get_json_params() ) ||
			strlen( $request->get_body() ) > 32768 ) return self::error( 'INVALID_REQUEST', 400 );
		$input = $request->get_json_params();
		return $this->forward( static fn( ModaApiClient $client, array $connection ) =>
			$client->merchantSupportCompose( $connection, $input ) );
	}

	public function markRead( \WP_REST_Request $request ): \WP_REST_Response {
		if ( true !== $this->authorizeAdministrator( $request ) ) return self::error( 'FORBIDDEN', 403 );
		$params = $request->get_url_params();
		if ( 'POST' !== $request->get_method() || ! self::queryAllowed( $request->get_query_params() ) ||
			! self::bodyEmpty( $request ) || array( 'messageId' ) !== array_keys( $params ) ||
			! SupportResponseValidator::messageId( $params['messageId'] ) ) return self::error( 'INVALID_REQUEST', 400 );
		$message_id = $params['messageId'];
		return $this->forward( static fn( ModaApiClient $client, array $connection ) =>
			$client->merchantSupportMarkRead( $connection, $message_id ) );
	}

	/** Never return a remote ACK from credentials that were rotated while the HTTP request ran. */
	private function forward( callable $operation ): \WP_REST_Response {
		if ( null === $this->api_client ) return self::error( 'API_NOT_CONFIGURED', 503 );
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) return self::error( 'LOCAL_STATE_INVALID', 409 );
		if ( 'valid' !== $local['state'] ) return self::error( 'RECONNECT_REQUIRED', 401 );
		$record = $local['record'];
		try {
			if ( $this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::error( 'SITE_URL_CHANGED', 409 );
			}
			$data = $operation( $this->api_client, $record );
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
				'support_unavailable' => array( 'SUPPORT_UNAVAILABLE', 403 ),
				'idempotency_conflict' => array( 'ACTION_CONFLICT', 409 ),
				'not_found' => array( 'NOT_FOUND', 404 ),
				'remote_response_invalid' => array( 'REMOTE_RESPONSE_INVALID', 502 ),
			);
			$outcome = $mapping[ $error->getMessage() ] ?? array( 'REMOTE_UNAVAILABLE', 503 );
			return self::error( $outcome[0], $outcome[1] );
		} catch ( \Throwable $error ) {
			return self::error( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	private static function queryAllowed( array $query, array $allowed = array() ): bool {
		foreach ( $query as $key => $value ) {
			if ( '_locale' === $key && 'user' === $value ) continue;
			if ( ! in_array( $key, $allowed, true ) ) return false;
		}
		return true;
	}

	private static function bodyEmpty( \WP_REST_Request $request ): bool {
		return '' === $request->get_body() && null === $request->get_json_params() &&
			array() === $request->get_body_params() && array() === $request->get_file_params();
	}

	private static function jsonHeader( \WP_REST_Request $request ): bool {
		$type = $request->get_header( 'Content-Type' );
		return is_string( $type ) &&
			1 === preg_match( '#^application/json(?:\s*;\s*charset=utf-8)?$#iD', $type );
	}

	private static function error( string $code, int $status ): \WP_REST_Response {
		return self::respond( array( 'status' => $code ), $status );
	}

	private static function respond( array $payload, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $payload, $status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}
