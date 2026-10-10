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

/** Privileged WordPress facade: no Woo keys, callback or shop-selected routing. */
final class ReadAccessController {
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
		register_rest_route( 'moda-interact/v1', '/connection/read-access', array(
			array( 'methods' => 'GET', 'callback' => array( $this, 'status' ), 'permission_callback' => array( $this, 'authorizeAdministrator' ) ),
			array( 'methods' => 'DELETE', 'callback' => array( $this, 'revoke' ), 'permission_callback' => array( $this, 'authorizeAdministrator' ) ),
		) );
		register_rest_route( 'moda-interact/v1', '/connection/read-access/authorize', array(
			'methods' => 'POST',
			'callback' => array( $this, 'start' ),
			'permission_callback' => array( $this, 'authorizeAdministrator' ),
		) );
	}

	/** Explicit nonce requirement in addition to core REST cookie authentication. */
	public function authorizeAdministrator( \WP_REST_Request $request ): bool|\WP_Error {
		if ( ! current_user_can( 'manage_woocommerce' ) ||
			! wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' ) ) {
			return new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
		}
		return true;
	}

	public function status( \WP_REST_Request $request ): \WP_REST_Response {
		return $this->perform( $request, 'status' );
	}

	public function start( \WP_REST_Request $request ): \WP_REST_Response {
		return $this->perform( $request, 'start' );
	}

	public function revoke( \WP_REST_Request $request ): \WP_REST_Response {
		return $this->perform( $request, 'revoke' );
	}

	private function perform( \WP_REST_Request $request, string $action ): \WP_REST_Response {
		$query = $request->get_query_params();
		if ( ( array() !== $query && ( array( '_locale' ) !== array_keys( $query ) || 'user' !== $query['_locale'] ) ) ||
			! in_array( $request->get_json_params(), array( null, array() ), true ) || array() !== $request->get_body_params() ) {
			return self::respond( array( 'status' => 'INVALID_REQUEST' ), 400 );
		}
		if ( null === $this->api_client ) {
			return self::respond( array( 'status' => 'API_NOT_CONFIGURED' ), 503 );
		}
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) {
			return self::respond( array( 'status' => 'LOCAL_STATE_INVALID' ), 409 );
		}
		if ( 'valid' !== $local['state'] ) {
			return self::respond( array( 'status' => 'RECONNECT_REQUIRED' ), 401 );
		}
		try {
			$record = $local['record'];
			if ( $this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::respond( array( 'status' => 'SITE_URL_CHANGED' ), 409 );
			}
			if ( 'start' === $action ) {
				$result = $this->api_client->beginRestReadAuthorization( $record );
			} elseif ( 'revoke' === $action ) {
				$result = $this->api_client->revokeRestReadAuthorization( $record );
			} else {
				$result = $this->api_client->restReadAuthorizationStatus( $record );
			}
			$after = $this->installation_store->read();
			if ( 'valid' !== $after['state'] || $after['record'] !== $record ||
				$this->site_identity->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::respond( array( 'status' => 'RECONNECT_REQUIRED' ), 409 );
			}
			return self::respond( $result, 'start' === $action ? 201 : 200 );
		} catch ( SiteIdentityException $error ) {
			return self::respond( array( 'status' => 'SITE_URL_CHANGED' ), 409 );
		} catch ( ModaApiClientException $error ) {
			$mapping = array(
				'unauthorized' => array( 'RECONNECT_REQUIRED', 401 ),
				'local_state_invalid' => array( 'LOCAL_STATE_INVALID', 409 ),
				'tenant_conflict' => array( 'RECONNECT_REQUIRED', 409 ),
				'remote_response_invalid' => array( 'REMOTE_RESPONSE_INVALID', 502 ),
			);
			$outcome = $mapping[ $error->getMessage() ] ?? array( 'REMOTE_UNAVAILABLE', 503 );
			return self::respond( array( 'status' => $outcome[0] ), $outcome[1] );
		} catch ( \Throwable $error ) {
			return self::respond( array( 'status' => 'REMOTE_UNAVAILABLE' ), 503 );
		}
	}

	private static function respond( array $body, int $code ): \WP_REST_Response {
		$response = new \WP_REST_Response( $body, $code );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		$response->header( 'Referrer-Policy', 'no-referrer' );
		return $response;
	}
}
