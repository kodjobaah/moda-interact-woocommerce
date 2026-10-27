<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ConversationCommandContracts;
use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;

/** The browser selects a recovery, never an arbitrary conversation or Shop. */
final class RecoveryConversationCommandController {
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

	public function register(): void { add_action( 'rest_api_init', array( $this, 'registerRoutes' ) ); }

	public function registerRoutes(): void {
		$base = '/merchant/recoveries/(?P<recoveryId>[A-Za-z0-9_-]{1,191})/conversation';
		foreach ( array( 'control' => '/control', 'messages' => '/messages',
			'status' => '/send-commands/(?P<commandId>[A-Za-z0-9_-]{1,191})',
			'templates' => '/follow-up-templates' ) as $kind => $suffix ) {
			register_rest_route( 'moda-interact/v1', $base . $suffix, array(
				'methods' => in_array( $kind, array( 'status', 'templates' ), true ) ? 'GET' : 'POST',
				'callback' => fn( \WP_REST_Request $request ) => $this->handle( $request, $kind ),
				'permission_callback' => array( $this, 'authorize' ),
			) );
		}
	}

	public function authorize( \WP_REST_Request $request ): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' ) &&
			(bool) wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' )
			? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function handle( \WP_REST_Request $request, string $operation ): \WP_REST_Response {
		if ( true !== $this->authorize( $request ) ) return self::error( 'FORBIDDEN', 403 );
		$ids = $request->get_url_params();
		$recovery_id = $ids['recoveryId'] ?? null;
		$command_id = $ids['commandId'] ?? null;
		$method = in_array( $operation, array( 'status', 'templates' ), true ) ? 'GET' : 'POST';
		$query = $request->get_query_params();
		if ( isset( $query['_locale'] ) && 'user' === $query['_locale'] ) unset( $query['_locale'] );
		if ( ! ConversationCommandContracts::identifier( $recovery_id ) || $query ||
			$method !== $request->get_method() || array() !== $request->get_body_params() ||
			array() !== $request->get_file_params() ||
			( 'status' === $operation ? ( ! ConversationCommandContracts::identifier( $command_id ) ||
				null !== $request->get_json_params() || '' !== $request->get_body() ) :
				( 'templates' === $operation ? ( null !== $command_id || null !== $request->get_json_params() || '' !== $request->get_body() ) :
				( null !== $command_id || ! preg_match( '#^application/json(?:\s*;\s*charset=utf-8)?$#iD',
					(string) $request->get_header( 'Content-Type' ) ) ||
					strlen( $request->get_body() ) > 6144 ||
					! ConversationCommandContracts::request( $request->get_json_params(), $operation ) ) ) ) ) {
			return self::error( 'INVALID_REQUEST', 400 );
		}
		if ( null === $this->client ) return self::error( 'API_NOT_CONFIGURED', 503 );
		$local = $this->installations->read();
		if ( 'valid' !== $local['state'] ) return self::error( 'invalid' === $local['state'] ? 'LOCAL_STATE_INVALID' : 'RECONNECT_REQUIRED', 401 );
		$connection = $local['record'];
		try {
			if ( $this->identity->currentCanonicalUrl() !== $connection['canonicalSiteUrl'] ) return self::error( 'SITE_URL_CHANGED', 409 );
			// The authenticated recovery read is the ownership gate. No browser
			// conversationId is trusted, and no command can target a standalone chat.
			$detail = $this->client->merchantRecoveryDetail( $connection, $recovery_id );
			$conversation = $detail['conversation']['id'] ?? null;
			if ( ! ConversationCommandContracts::identifier( $conversation ) || ! $detail['hasConversation'] ) {
				return self::error( 'CONVERSATION_UNAVAILABLE', 404 );
			}
			if ( 'templates' === $operation ) {
				$result = array( 'data' => $this->client->merchantRecoveryFollowUpTemplates( $connection, $conversation ), 'status' => 200 );
			} else {
				$result = $this->client->merchantConversationCommand( $connection, $conversation, $operation,
					'status' === $operation ? null : $request->get_json_params(), $command_id );
			}
			$after = $this->installations->read();
			if ( 'valid' !== $after['state'] || $after['record'] !== $connection ||
				$this->identity->currentCanonicalUrl() !== $connection['canonicalSiteUrl'] ) return self::error( 'RECONNECT_REQUIRED', 409 );
			return self::respond( $result['data'], $result['status'] );
		} catch ( SiteIdentityException $error ) { return self::error( 'SITE_URL_CHANGED', 409 ); }
		catch ( ModaApiClientException $error ) {
			$code = strtoupper( $error->getMessage() );
			$statuses = array( 'UNAUTHORIZED' => 401, 'NOT_FOUND' => 404, 'INVALID_REQUEST' => 400,
				'REQUEST_TOO_LARGE' => 413, 'HUMAN_MESSAGING_SUSPENDED' => 403,
				'IDEMPOTENCY_CONFLICT' => 409, 'STALE_CONTROL_REVISION' => 409,
				'CONVERSATION_CONTROL_CONFLICT' => 409, 'NOT_HUMAN_CONTROLLED' => 409,
				'FOLLOW_UP_UNAVAILABLE' => 409, 'TEMPLATE_NOT_ALLOWED' => 409,
				'SERVICE_WINDOW_CLOSED' => 409, 'RECIPIENT_UNAVAILABLE' => 409,
				'SEND_ENTITLEMENT_UNAVAILABLE' => 409, 'HUMAN_CONTENT_INVALID' => 409,
				'REMOTE_RESPONSE_INVALID' => 502 );
			if ( 'UNAUTHORIZED' === $code ) return self::error( 'RECONNECT_REQUIRED', 401 );
			return isset( $statuses[$code] ) ? self::error( $code, $statuses[$code] ) : self::error( 'REMOTE_UNAVAILABLE', 503 );
		} catch ( \Throwable $error ) { return self::error( 'REMOTE_UNAVAILABLE', 503 ); }
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
