<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Connection\BootstrapAttemptStore;
use ModaInteract\WooCommerce\Connection\ConnectionCoordinator;
use ModaInteract\WooCommerce\Connection\ConnectionCoordinatorException;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;
use ModaInteract\WooCommerce\Security\Base64Url;
use ModaInteract\WooCommerce\Security\HmacProof;

final class ConnectionController {
	private ?ModaApiConfiguration $configuration;
	private ?ModaApiClient $api_client;
	private readonly SiteIdentity $site_identity;
	private readonly BootstrapAttemptStore $attempt_store;
	private readonly InstallationStore $installation_store;
	private readonly ?ConnectionCoordinator $coordinator;

	public function __construct(
		?ModaApiConfiguration $configuration = null,
		?SiteIdentity $site_identity = null,
		?BootstrapAttemptStore $attempt_store = null,
		?InstallationStore $installation_store = null,
		?ModaApiClient $api_client = null
	) {
		try {
			$this->configuration = $configuration ?? ModaApiConfiguration::fromServerConfiguration();
		} catch ( ModaApiConfigurationException $error ) {
			$this->configuration = null;
		}
		try {
			$mode = ModaApiConfiguration::serverMode();
		} catch ( ModaApiConfigurationException $error ) {
			$mode = ModaApiConfiguration::MODE_PUBLIC;
		}
		$this->site_identity      = $site_identity ?? new SiteIdentity( $mode );
		$this->attempt_store      = $attempt_store ?? new BootstrapAttemptStore();
		$this->installation_store = $installation_store ?? new InstallationStore();
		$this->api_client         = $api_client ?? ( $this->configuration ? new ModaApiClient( $this->configuration ) : null );
		$this->coordinator        = $this->api_client ? new ConnectionCoordinator( $this->site_identity, $this->attempt_store, $this->installation_store, $this->api_client ) : null;
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoutes' ) );
	}

	public function registerRoutes(): void {
		register_rest_route(
			'moda-interact/v1',
			'/connection',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'getConnection' ),
					'permission_callback' => array( $this, 'authorizeAdministrator' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'postConnection' ),
					'permission_callback' => array( $this, 'authorizeAdministrator' ),
				),
			)
		);
		register_rest_route(
			'moda-interact/v1',
			'/connection/challenge',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'getChallenge' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public function authorizeAdministrator(): bool|\WP_Error {
		if ( current_user_can( 'manage_woocommerce' ) ) {
			return true;
		}
		return new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function getConnection( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		if ( ! self::requestHasNoInput( $request ) ) {
			return self::error( 'invalid_request', 400 );
		}
		if ( ! $this->configuration || ! $this->api_client ) {
			return self::state( 'API_NOT_CONFIGURED', 503 );
		}
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) {
			return self::state( 'LOCAL_STATE_INVALID', 200 );
		}
		if ( 'missing' === $local['state'] ) {
			return self::state( 'DISCONNECTED', 200 );
		}
		try {
			if ( $this->site_identity->currentCanonicalUrl() !== $local['record']['canonicalSiteUrl'] ) {
				return self::state( 'SITE_URL_CHANGED', 200 );
			}
			$principal = $this->api_client->probe( $local['record'] );
			return new \WP_REST_Response(
				array_merge( array( 'status' => 'CONNECTED' ), array_intersect_key( $principal, array_flip( array( 'installationId', 'shopId', 'canonicalSiteUrl', 'credentialVersion' ) ) ) ),
				200
			);
		} catch ( ModaApiClientException $error ) {
			if ( 'unauthorized' === $error->getMessage() ) {
				return self::state( 'RECONNECT_REQUIRED', 200 );
			}
			return self::state( 'REMOTE_UNAVAILABLE', 200 );
		} catch ( SiteIdentityException $error ) {
			return self::state( 'SITE_URL_CHANGED', 200 );
		} catch ( \Throwable $error ) {
			return self::state( 'REMOTE_UNAVAILABLE', 200 );
		}
	}

	public function postConnection( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		if ( ! self::requestHasNoInput( $request ) ) {
			return self::error( 'invalid_request', 400 );
		}
		if ( ! $this->configuration || ! $this->coordinator ) {
			return self::state( 'API_NOT_CONFIGURED', 503 );
		}
		try {
			return new \WP_REST_Response( $this->coordinator->connect(), 200 );
		} catch ( SiteIdentityException $error ) {
			return self::error( $error->getMessage(), 400 );
		} catch ( ModaApiClientException $error ) {
			if ( 'remote_rejected' === $error->getMessage() ) {
				return self::state( 'CONNECTION_FAILED', 422 );
			}
			return self::state( 'REMOTE_UNAVAILABLE', 503 );
		} catch ( ConnectionCoordinatorException $error ) {
			return 'local_persistence_failed' === $error->getMessage()
				? self::state( 'LOCAL_PERSISTENCE_FAILED', 500 )
				: self::state( 'REMOTE_UNAVAILABLE', 503 );
		} catch ( ModaApiConfigurationException $error ) {
			return self::state( 'API_NOT_CONFIGURED', 503 );
		} catch ( \Throwable $error ) {
			return self::state( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	public function getChallenge( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$query = $request->get_query_params();
		$keys = is_array( $query ) ? array_keys( $query ) : array();
		sort( $keys );
		if ( array( 'attempt_id', 'nonce' ) !== $keys ) {
			return self::error( 'connection_attempt_invalid', 404 );
		}
		$attempt_id = $query['attempt_id'];
		$nonce      = $query['nonce'];
		if (
			! is_string( $attempt_id ) ||
			! preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $attempt_id ) ||
			! is_string( $nonce ) ||
			null === Base64Url::decode( $nonce, 32 )
		) {
			return self::error( 'connection_attempt_invalid', 404 );
		}
		$attempt = $this->attempt_store->consume( $attempt_id );
		if ( ! $attempt ) {
			return self::error( 'connection_attempt_invalid', 404 );
		}
		$secret = Base64Url::decode( $attempt['bootstrapSecret'], 32 );
		if ( null === $secret ) {
			return self::error( 'connection_attempt_invalid', 404 );
		}
		return new \WP_REST_Response(
			array(
				'attemptId' => $attempt_id,
				'nonce'     => $nonce,
				'proof'     => HmacProof::create( $secret, $attempt_id, $nonce, $attempt['canonicalSiteUrl'] ),
			),
			200
		);
	}

	private static function requestHasNoInput( \WP_REST_Request $request ): bool {
		$json  = $request->get_json_params();
		$body  = $request->get_body_params();
		$query = $request->get_query_params();
		return ( null === $json || array() === $json ) && array() === $body && array() === $query;
	}

	private static function state( string $status, int $http_status ): \WP_REST_Response {
		return new \WP_REST_Response( array( 'status' => $status ), $http_status );
	}

	private static function error( string $code, int $http_status ): \WP_Error {
		return new \WP_Error( $code, $code, array( 'status' => $http_status ) );
	}
}