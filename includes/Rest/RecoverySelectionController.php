<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Api\RecoverySelectionContracts;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;

/** Privileged, per-installation proxy; never accepts a shop or customer selector. */
final class RecoverySelectionController {
	private readonly ?ModaApiClient $client;
	private readonly SiteIdentity $identity;
	private readonly InstallationStore $installations;

	public function __construct( ?ModaApiClient $client = null, ?SiteIdentity $identity = null, ?InstallationStore $installations = null ) {
		try { $config = ModaApiConfiguration::fromServerConfiguration(); }
		catch ( ModaApiConfigurationException $error ) { $config = null; }
		try { $mode = ModaApiConfiguration::serverMode(); }
		catch ( ModaApiConfigurationException $error ) { $mode = ModaApiConfiguration::MODE_PUBLIC; }
		$this->client = $client ?? ( $config ? new ModaApiClient( $config ) : null );
		$this->identity = $identity ?? new SiteIdentity( $mode );
		$this->installations = $installations ?? new InstallationStore();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoutes' ) );
	}

	public function registerRoutes(): void {
		register_rest_route( 'moda-interact/v1', '/merchant/customer-recovery-selection', array(
			array( 'methods' => 'GET', 'callback' => array( $this, 'status' ), 'permission_callback' => array( $this, 'authorize' ) ),
			array( 'methods' => 'POST', 'callback' => array( $this, 'command' ), 'permission_callback' => array( $this, 'authorize' ) ),
		) );
	}

	public function authorize( \WP_REST_Request $request ): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' ) &&
			(bool) wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' )
			? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function status( \WP_REST_Request $request ): \WP_REST_Response {
		if ( true !== $this->authorize( $request ) ) return self::error( 'FORBIDDEN', 403 );
		$query = $request->get_query_params();
		if ( 'GET' !== $request->get_method() || ! self::queryAllowed( $query, true ) ||
			! RecoverySelectionContracts::phone( $query['canonicalPhone'] ?? null ) || ! self::bodyEmpty( $request ) ) {
			return self::error( 'INVALID_REQUEST', 400 );
		}
		return $this->forward( static fn( ModaApiClient $client, array $installation ) =>
			$client->merchantRecoverySelectionStatus( $installation, $query['canonicalPhone'] ) );
	}

	public function command( \WP_REST_Request $request ): \WP_REST_Response {
		if ( true !== $this->authorize( $request ) ) return self::error( 'FORBIDDEN', 403 );
		$input = $request->get_json_params();
		$type = (string) $request->get_header( 'Content-Type' );
		if ( 'POST' !== $request->get_method() || ! self::queryAllowed( $request->get_query_params(), false ) ||
			array() !== $request->get_body_params() || array() !== $request->get_file_params() ||
			1 !== preg_match( '#^application/json(?:\s*;\s*charset=utf-8)?$#iD', $type ) ||
			strlen( $request->get_body() ) > 2048 || ! RecoverySelectionContracts::command( $input ) ) {
			return self::error( 'INVALID_REQUEST', 400 );
		}
		return $this->forward( static fn( ModaApiClient $client, array $installation ) =>
			$client->merchantRecoverySelectionCommand( $installation, $input ) );
	}

	private function forward( callable $operation ): \WP_REST_Response {
		if ( null === $this->client ) return self::error( 'API_NOT_CONFIGURED', 503 );
		$local = $this->installations->read();
		if ( 'valid' !== $local['state'] ) return self::error( 'invalid' === $local['state'] ? 'LOCAL_STATE_INVALID' : 'RECONNECT_REQUIRED', 401 );
		$installation = $local['record'];
		try {
			if ( $this->identity->currentCanonicalUrl() !== $installation['canonicalSiteUrl'] ) return self::error( 'SITE_URL_CHANGED', 409 );
			$data = $operation( $this->client, $installation );
			$after = $this->installations->read();
			if ( 'valid' !== $after['state'] || $after['record'] !== $installation ||
				$this->identity->currentCanonicalUrl() !== $installation['canonicalSiteUrl'] ) return self::error( 'RECONNECT_REQUIRED', 409 );
			return self::respond( $data, 200 );
		} catch ( SiteIdentityException $error ) {
			return self::error( 'SITE_URL_CHANGED', 409 );
		} catch ( ModaApiClientException $error ) {
			$code = strtoupper( $error->getMessage() );
			$status = $error->http_status ?? 503;
			$codes = array( 'UNAUTHORIZED', 'ADMIN_AUTHORIZATION_REQUIRED', 'INVALID_REQUEST', 'REQUEST_TOO_LARGE',
				'CUSTOMER_PHONE_NOT_FOUND', 'AMBIGUOUS_CUSTOMER_PHONE', 'STALE_NO_CONTACT_REVISION',
				'CUSTOMER_CONSENT_REQUIRED', 'CUSTOMER_STOP_AUTHORITATIVE', 'SELECTION_UNAVAILABLE', 'REMOTE_RESPONSE_INVALID' );
			if ( ! in_array( $code, $codes, true ) ) { $code = 'REMOTE_UNAVAILABLE'; $status = 503; }
			return self::error( $code, $status );
		} catch ( \Throwable $error ) {
			return self::error( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	private static function queryAllowed( array $query, bool $read ): bool {
		foreach ( $query as $key => $value ) {
			if ( '_locale' === $key && 'user' === $value ) continue;
			if ( ! $read || 'canonicalPhone' !== $key ) return false;
		}
		return true;
	}

	private static function bodyEmpty( \WP_REST_Request $request ): bool {
		return '' === $request->get_body() && null === $request->get_json_params() &&
			array() === $request->get_body_params() && array() === $request->get_file_params();
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
