<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Api\RecoveryPolicyResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;

/** Capability and nonce-protected WooCommerce proxy; no browser-controlled Shop identity. */
final class RecoveryPolicyController {
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
		register_rest_route( 'moda-interact/v1', '/merchant/recovery-policy', array(
			'methods' => array( 'GET', 'PUT' ),
			'callback' => array( $this, 'handle' ),
			'permission_callback' => array( $this, 'authorizeAdministrator' ),
		) );
	}

	public function authorizeAdministrator( \WP_REST_Request $request ): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' ) &&
			(bool) wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' )
			? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! in_array( $request->get_method(), array( 'GET', 'PUT' ), true ) || ! self::queryAllowed( $request ) ||
			array() !== $request->get_body_params() ) return self::error( 'INVALID_REQUEST', 400 );
		$is_put = 'PUT' === $request->get_method();
		$update = $is_put ? $request->get_json_params() : null;
		if ( $is_put && ( ! is_string( $request->get_header( 'Content-Type' ) ) ||
			! preg_match( '#^application/json(?:\s*;\s*charset=utf-8)?$#i', $request->get_header( 'Content-Type' ) ) ||
			! RecoveryPolicyResponseValidator::isUpdate( $update ) ) ) return self::error( 'INVALID_REQUEST', 400 );
		if ( ! $is_put && null !== $request->get_json_params() ) return self::error( 'INVALID_REQUEST', 400 );
		if ( null === $this->api_client ) return self::error( 'API_NOT_CONFIGURED', 503 );
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) return self::error( 'LOCAL_STATE_INVALID', 409 );
		if ( 'valid' !== $local['state'] ) return self::error( 'RECONNECT_REQUIRED', 401 );
		try {
			$record = $local['record'];
			if ( $this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::error( 'SITE_URL_CHANGED', 409 );
			}
			$data = $this->api_client->merchantRecoveryPolicy( $record, $update );
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
				'policy_conflict' => array( 'POLICY_CONFLICT', 409 ),
				'offer_unsupported' => array( 'OFFER_UNSUPPORTED', 409 ),
				'tenant_conflict' => array( 'POLICY_UNAVAILABLE', 409 ),
				'remote_response_invalid' => array( 'REMOTE_RESPONSE_INVALID', 502 ),
			);
			$outcome = $mapping[ $error->getMessage() ] ?? array( 'REMOTE_UNAVAILABLE', 503 );
			return self::error( $outcome[0], $outcome[1] );
		} catch ( \Throwable $error ) {
			try {
				if ( function_exists( 'wc_get_logger' ) ) {
					wc_get_logger()->error( 'Recovery policy proxy request failed.', array(
						'source' => 'moda-interact',
						'operation' => 'merchant_recovery_policy_proxy',
						'error_class' => get_class( $error ),
						'error_code' => (string) $error->getCode(),
					) );
				}
			} catch ( \Throwable $logging_error ) {
				// Keep the sanitized proxy response even when WooCommerce's log sink fails.
				error_log( sprintf(
					'Moda Interact recovery policy logging failed (operation=merchant_recovery_policy_proxy; error_class=%s; error_code=%s; sink_error_class=%s; sink_error_code=%s).',
					get_class( $error ),
					(string) $error->getCode(),
					get_class( $logging_error ),
					(string) $logging_error->getCode()
				) );
			}
			return self::error( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	private static function queryAllowed( \WP_REST_Request $request ): bool {
		$query = $request->get_query_params();
		return array() === $query || ( array( '_locale' ) === array_keys( $query ) && 'user' === $query['_locale'] );
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
