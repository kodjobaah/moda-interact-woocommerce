<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Api\MerchantKnowledgeContracts as Contract;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;

/** Browser-to-WordPress REST boundary. Does not own entitlement or source-state decisions. */
final class MerchantKnowledgeController {
	private readonly ?ModaApiClient $api;
	private readonly SiteIdentity $site;
	private readonly InstallationStore $store;

	public function __construct( ?ModaApiClient $api = null, ?SiteIdentity $site = null,
		?InstallationStore $store = null ) {
		try { $config = ModaApiConfiguration::fromServerConfiguration(); }
		catch ( ModaApiConfigurationException $exception ) { $config = null; }
		try { $mode = ModaApiConfiguration::serverMode(); }
		catch ( ModaApiConfigurationException $exception ) { $mode = ModaApiConfiguration::MODE_PUBLIC; }
		$this->api = $api ?? ( $config ? new ModaApiClient( $config ) : null );
		$this->site = $site ?? new SiteIdentity( $mode );
		$this->store = $store ?? new InstallationStore();
	}

	public function register(): void { add_action( 'rest_api_init', array( $this, 'registerRoutes' ) ); }
	public function registerRoutes(): void {
		$routes = array(
			'/merchant/feature-preferences' => array( 'GET', 'PUT' ),
			'/merchant/merchant-knowledge' => array( 'GET' ),
			'/merchant/merchant-knowledge/sources' => array( 'POST' ),
			'/merchant/merchant-knowledge/sources/(?P<id>[A-Za-z0-9_-]{1,128})' => array( 'PATCH', 'DELETE' ),
			'/merchant/merchant-knowledge/sources/(?P<id>[A-Za-z0-9_-]{1,128})/refresh' => array( 'POST' ),
			'/merchant/merchant-knowledge/order' => array( 'PUT' ),
			'/merchant/merchant-knowledge/upload-intents' => array( 'POST' ),
			'/merchant/merchant-knowledge/upload-finalize' => array( 'POST' ),
			'/merchant/merchant-knowledge/uploads/(?P<id>[A-Za-z0-9_-]{1,128})' => array( 'PATCH' ),
			'/merchant/merchant-knowledge/uploads/(?P<id>[A-Za-z0-9_-]{1,128})/reprocess' => array( 'POST' ),
		);
		foreach ( $routes as $path => $methods ) {
			register_rest_route( 'moda-interact/v1', $path, array(
				'methods' => $methods,
				'callback' => array( $this, 'handle' ),
				'permission_callback' => array( $this, 'authorizeAdministrator' ),
			) );
		}
	}

	public function authorizeAdministrator( \WP_REST_Request $request ): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' ) &&
			(bool) wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' )
			? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		// Local diagnostics are explicitly opt-in. Never log a signed URL, request
		// payload, installation credential or file metadata.
		$trace_id = self::uploadTraceEnabled() && 'POST' === $request->get_method() &&
			'/moda-interact/v1/merchant/merchant-knowledge/upload-intents' === $request->get_route()
			? str_replace( '.', '', uniqid( 'woo-', true ) ) : null;
		$started_at = microtime( true );
		self::traceUploadIntent( $trace_id, $started_at, 'request_received' );
		if ( true !== $this->authorizeAdministrator( $request ) ) {
			self::traceUploadIntent( $trace_id, $started_at, 'authorization_rejected', 403 );
			return self::error( 'FORBIDDEN', 403 );
		}
		if ( null === $this->api ) {
			self::traceUploadIntent( $trace_id, $started_at, 'api_not_configured', 503 );
			return self::error( 'API_NOT_CONFIGURED', 503 );
		}
		$query = $request->get_query_params();
		// WordPress apiFetch may add its own administrator-locale selector. It is
		// local to WordPress and must not be forwarded to the hosted API.
		if ( array_key_exists( '_locale', $query ) ) {
			if ( 'user' !== $query['_locale'] ) return self::error( 'INVALID_REQUEST', 400 );
			unset( $query['_locale'] );
		}
		$position = null;
		if ( array_key_exists( 'afterPosition', $query ) ) {
			if ( count( $query ) !== 1 || ! is_string( $query['afterPosition'] ) ||
				! preg_match( '/^(0|[1-9][0-9]{0,9})$/D', $query['afterPosition'] ) || (int) $query['afterPosition'] > 2147483647 ) return self::error( 'INVALID_REQUEST', 400 );
			$position = (int) $query['afterPosition'];
		} elseif ( array() !== $query ) return self::error( 'INVALID_REQUEST', 400 );
		$path = $request->get_route();
		$id = $request->get_url_params()['id'] ?? null;
		$method = $request->get_method();
		$op = $this->operation( $path, $method, $id );
		if ( null === $op || ( null !== $position && 'knowledge_read' !== $op ) ) return self::error( 'INVALID_REQUEST', 400 );
		// Never accept CSV/XLSX bytes or multipart data, including on the intent route.
		if ( array() !== $request->get_file_params() ) return self::error( 'INVALID_REQUEST', 400 );
		$is_get = in_array( $op, array( 'features_read', 'knowledge_read' ), true );
		$is_empty = 'reprocess' === $op;
		if ( array() !== $request->get_body_params() ) return self::error( 'INVALID_REQUEST', 400 );
		if ( ( $is_get || $is_empty ) && ( null !== $request->get_json_params() || '' !== $request->get_body() ) ) {
			return self::error( 'INVALID_REQUEST', 400 );
		}
		$data = null;
		if ( ! $is_get && ! $is_empty ) {
			if ( ! is_string( $request->get_header( 'Content-Type' ) ) ||
				! preg_match( '#^application/json(?:\s*;\s*charset=utf-8)?$#iD', $request->get_header( 'Content-Type' ) ) ) return self::error( 'INVALID_REQUEST', 400 );
			$limit = str_starts_with( $op, 'upload_' ) ? 4096 : 65536;
			if ( strlen( $request->get_body() ) > $limit ) return self::error( 'REQUEST_TOO_LARGE', 413 );
			$data = $request->get_json_params();
			$kind = match ( $op ) {
				'features_update' => 'features_update', 'web_create' => 'web_create', 'web_patch' => 'web_patch',
				'refresh', 'remove' => 'generation', 'order' => 'order', 'upload_edit' => 'upload_edit',
				'upload_intent' => 'upload_intent', 'upload_finalize' => 'upload_finalize', default => '',
			};
			if ( ! Contract::request( $kind, $data ) ) return self::error( 'INVALID_REQUEST', 400 );
		}
		$local = $this->store->read();
		if ( 'invalid' === $local['state'] ) {
			self::traceUploadIntent( $trace_id, $started_at, 'local_state_invalid', 409 );
			return self::error( 'LOCAL_STATE_INVALID', 409 );
		}
		if ( 'valid' !== $local['state'] ) {
			self::traceUploadIntent( $trace_id, $started_at, 'reconnect_required', 401 );
			return self::error( 'RECONNECT_REQUIRED', 401 );
		}
		try {
			$record = $local['record'];
			$this->assertRecord( $record );
			$host_path = $this->apiPath( $op, $id, $position );
			self::traceUploadIntent( $trace_id, $started_at, 'upstream_request_started', null,
				array( 'apiEndpoint' => $this->api->knowledgeUploadIntentEndpointForDiagnostics(), 'apiMethod' => $method ) );
			$result = $this->api->merchantKnowledgeExchange( $record, $host_path, $method, $data );
			self::traceUploadIntent( $trace_id, $started_at, 'upstream_response_decoded', null,
				array( 'capabilityFields' => array_values( array_intersect( array_keys( $result ),
					array( 'schemaVersion', 'assetId', 'uploadUrl', 'expiresAt', 'maxUploadBytes', 'requiredHeaders' ) ) ),
					'unexpectedFieldCount' => count( array_diff( array_keys( $result ),
						array( 'schemaVersion', 'assetId', 'uploadUrl', 'expiresAt', 'maxUploadBytes', 'requiredHeaders' ) ) ) ) );
			$this->assertRecord( $record );
			$valid = match ( $op ) {
				'features_read', 'features_update' => Contract::featureResponse( $result ),
				'knowledge_read' => Contract::knowledgeResponse( $result ),
				'upload_edit' => Contract::editResult( $result ),
				'reprocess', 'upload_finalize' => Contract::uploadResult( $result ),
				'upload_intent' => Contract::intentResponse( $result, $data ),
				default => Contract::commandResponse( $result ),
			};
			if ( ! $valid ) {
				self::traceUploadIntent( $trace_id, $started_at, 'intent_response_invalid', 502 );
				return self::error( 'REMOTE_RESPONSE_INVALID', 502 );
			}
			self::traceUploadIntent( $trace_id, $started_at, 'intent_response_accepted' );
			$status = 'web_create' === $op && ( $result['created'] ?? false ) ? 201 : 200;
			// Prepared is not proof that Nginx or Cloudflare delivered the response.
			self::traceUploadIntent( $trace_id, $started_at, 'response_prepared', $status );
			return self::respond( $result, $status );
		} catch ( SiteIdentityException $exception ) {
			self::traceUploadIntent( $trace_id, $started_at, 'site_url_changed', 409 );
			return self::error( 'SITE_URL_CHANGED', 409 );
		} catch ( ModaApiClientException $exception ) {
			$response = $this->apiError( $exception );
			$reason = $exception->getMessage();
			$known = array( 'unauthorized', 'connection_changed', 'local_state_invalid',
				'invalid_request', 'remote_response_invalid', 'remote_rejected', 'remote_unavailable' );
			self::traceUploadIntent( $trace_id, $started_at,
				'api_error_' . ( in_array( $reason, $known, true ) ? $reason : 'unknown' ), $response->get_status() );
			return $response;
		} catch ( \Throwable $exception ) {
			self::traceUploadIntent( $trace_id, $started_at, 'unexpected_exception', 503 );
			return self::error( 'REMOTE_UNAVAILABLE', 503 );
		}
	}

	private static function uploadTraceEnabled(): bool {
		return ( defined( 'MODA_INTERACT_WOO_UPLOAD_TRACE' ) && true === constant( 'MODA_INTERACT_WOO_UPLOAD_TRACE' ) ) ||
			'1' === getenv( 'MODA_INTERACT_WOO_UPLOAD_TRACE' );
	}

	/** Local, opt-in upload-intent diagnostics; never affect merchant operations. */
	private static function traceUploadIntent( ?string $trace_id, float $started_at, string $stage, ?int $status = null, array $details = array() ): void {
		if ( null === $trace_id ) return;
		$payload = array( 'event' => 'woocommerce.merchant_knowledge.upload_intent',
			'traceId' => $trace_id, 'stage' => $stage,
			'elapsedMs' => (int) round( ( microtime( true ) - $started_at ) * 1000 ) );
		if ( null !== $status ) $payload['httpStatus'] = $status;
		if ( array() !== $details ) $payload['details'] = $details;
		try {
			$encoded = wp_json_encode( $payload );
			if ( is_string( $encoded ) ) @error_log( '[moda-interact] ' . $encoded );
		} catch ( \Throwable $ignored ) {
			// Diagnostics must not affect upload or error handling.
		}
	}

	private function assertRecord( array $record ): void {
		$current = $this->store->read();
		if ( 'valid' !== $current['state'] || $current['record'] !== $record ) throw new ModaApiClientException( 'connection_changed' );
		if ( $this->site->currentCanonicalUrl() !== $record['canonicalSiteUrl'] ) throw new SiteIdentityException( 'changed' );
	}

	private function operation( string $path, string $method, mixed $id ): ?string {
		$base = '/moda-interact/v1/merchant/';
		$map = array(
			$base . 'feature-preferences' => array( 'GET' => 'features_read', 'PUT' => 'features_update' ),
			$base . 'merchant-knowledge' => array( 'GET' => 'knowledge_read' ),
			$base . 'merchant-knowledge/sources' => array( 'POST' => 'web_create' ),
			$base . 'merchant-knowledge/order' => array( 'PUT' => 'order' ),
			$base . 'merchant-knowledge/upload-intents' => array( 'POST' => 'upload_intent' ),
			$base . 'merchant-knowledge/upload-finalize' => array( 'POST' => 'upload_finalize' ),
		);
		if ( isset( $map[ $path ][ $method ] ) && null === $id ) return $map[ $path ][ $method ];
		if ( ! Contract::id( $id ) ) return null;
		$prefix = $base . 'merchant-knowledge/';
		$dynamic = array(
			'sources/' . $id => array( 'PATCH' => 'web_patch', 'DELETE' => 'remove' ),
			'sources/' . $id . '/refresh' => array( 'POST' => 'refresh' ),
			'uploads/' . $id => array( 'PATCH' => 'upload_edit' ),
			'uploads/' . $id . '/reprocess' => array( 'POST' => 'reprocess' ),
		);
		return str_starts_with( $path, $prefix ) ? ( $dynamic[ substr( $path, strlen( $prefix ) ) ][ $method ] ?? null ) : null;
	}
	private function apiPath( string $op, ?string $id, ?int $position ): string {
		$base = '/v1/merchant/merchant-knowledge';
		return match ( $op ) {
			'features_read', 'features_update' => '/v1/merchant/feature-preferences',
			'knowledge_read' => $base . ( null === $position ? '' : '?afterPosition=' . $position ),
			'web_create' => $base . '/sources', 'web_patch', 'remove' => $base . '/sources/' . $id,
			'refresh' => $base . '/sources/' . $id . '/refresh', 'order' => $base . '/order',
			'upload_edit' => $base . '/uploads/' . $id, 'reprocess' => $base . '/uploads/' . $id . '/reprocess',
			'upload_intent' => $base . '/upload-intents', 'upload_finalize' => $base . '/upload-finalize',
		};
	}

	private function apiError( ModaApiClientException $exception ): \WP_REST_Response {
		$status = $exception->http_status;
		if ( 'unauthorized' === $exception->getMessage() ) return self::error( 'RECONNECT_REQUIRED', 401 );
		if ( 'connection_changed' === $exception->getMessage() || 'local_state_invalid' === $exception->getMessage() ) return self::error( 'RECONNECT_REQUIRED', 409 );
		if ( 'invalid_request' === $exception->getMessage() ) return self::error( 'INVALID_REQUEST', 400 );
		if ( 'remote_response_invalid' === $exception->getMessage() ) return self::error( 'REMOTE_RESPONSE_INVALID', 502 );
		if ( 'remote_rejected' === $exception->getMessage() && in_array( $status, array( 400, 403, 404, 409, 413 ), true ) ) {
			return self::error( match ( $status ) { 400 => 'INVALID_REQUEST', 403 => 'DENIED', 404 => 'NOT_FOUND', 409 => 'CONFLICT', 413 => 'REQUEST_TOO_LARGE' }, $status );
		}
		return self::error( 'REMOTE_UNAVAILABLE', 503 );
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
