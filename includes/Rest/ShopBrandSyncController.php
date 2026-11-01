<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\ShopBrand\Publisher;
use ModaInteract\WooCommerce\ShopBrand\SyncStatusStore;

/** Same-origin merchant controls for the existing asynchronous branding publisher. */
final class ShopBrandSyncController {
	public function __construct(
		private readonly ?Publisher $publisher = null,
		private readonly ?SiteIdentity $identity = null,
		private readonly ?InstallationStore $installations = null,
		private readonly ?SyncStatusStore $statuses = null
	) {}

	public function register(): void { add_action( 'rest_api_init', array( $this, 'registerRoutes' ) ); }

	public function registerRoutes(): void {
		register_rest_route( 'moda-interact/v1', '/merchant/shop-brand/sync', array(
			array( 'methods' => 'GET', 'callback' => array( $this, 'read' ), 'permission_callback' => array( $this, 'authorize' ) ),
			array( 'methods' => 'POST', 'callback' => array( $this, 'requestSync' ), 'permission_callback' => array( $this, 'authorize' ) ),
		) );
	}

	public function authorize( \WP_REST_Request $request ): bool|\WP_Error {
		if ( ! current_user_can( 'manage_woocommerce' ) ||
			! wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' ) ) {
			return new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
		}
		return true;
	}

	public function read( \WP_REST_Request $request ): \WP_REST_Response {
		if ( 'GET' !== $request->get_method() || ! self::emptyInput( $request ) ) return self::error( 'INVALID_REQUEST', 400 );
		$connection = $this->connection();
		if ( $connection instanceof \WP_REST_Response ) return $connection;
		$state = ( $this->statuses ?? new SyncStatusStore() )->read( $connection['installationId'], $connection['canonicalSiteUrl'] );
		return self::respond( array(
			'status' => $state['status'],
			'lastRequestedAt' => $state['lastRequestedAt'],
			'lastAcceptedAt' => $state['lastAcceptedAt'],
		), 200 );
	}

	public function requestSync( \WP_REST_Request $request ): \WP_REST_Response {
		if ( 'POST' !== $request->get_method() || ! self::emptyInput( $request ) ) return self::error( 'INVALID_REQUEST', 400 );
		$connection = $this->connection();
		if ( $connection instanceof \WP_REST_Response ) return $connection;
		$result = ( $this->publisher ?? new Publisher() )->requestSyncDetailed();
		if ( null === $result || ! in_array( $result['status'] ?? null, array( 'QUEUED', 'ALREADY_QUEUED' ), true ) ) {
			return self::error( 'SYNC_UNAVAILABLE', 503 );
		}
		return self::respond( array( 'status' => $result['status'] ), 202 );
	}

	private function connection(): array|\WP_REST_Response {
		$local = ( $this->installations ?? new InstallationStore() )->read();
		if ( 'invalid' === $local['state'] ) return self::error( 'LOCAL_STATE_INVALID', 409 );
		if ( 'valid' !== $local['state'] ) return self::error( 'RECONNECT_REQUIRED', 401 );
		try {
			$record = $local['record'];
			if ( ( $this->identity ?? new SiteIdentity( \ModaInteract\WooCommerce\Api\ModaApiConfiguration::serverMode() ) )->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) {
				return self::error( 'SITE_URL_CHANGED', 409 );
			}
			return $record;
		} catch ( \Throwable $error ) {
			return self::error( 'SITE_URL_CHANGED', 409 );
		}
	}

	private static function emptyInput( \WP_REST_Request $request ): bool {
		$query = $request->get_query_params();
		if ( array_key_exists( '_locale', $query ) ) {
			if ( 'user' !== $query['_locale'] ) return false;
			unset( $query['_locale'] );
		}
		return array() === $query && in_array( $request->get_json_params(), array( null, array() ), true ) &&
			array() === $request->get_body_params() && array() === $request->get_file_params() &&
			( ! method_exists( $request, 'get_body' ) || '' === $request->get_body() || '{}' === trim( $request->get_body() ) );
	}

	private static function error( string $code, int $status ): \WP_REST_Response { return self::respond( array( 'status' => $code ), $status ); }

	private static function respond( array $data, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		$response->header( 'Referrer-Policy', 'no-referrer' );
		return $response;
	}
}
