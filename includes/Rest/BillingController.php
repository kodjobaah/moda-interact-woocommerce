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

final class BillingController {
	private ?ModaApiConfiguration $configuration;
	private ?ModaApiClient $api_client;
	private readonly InstallationStore $installation_store;
	private readonly SiteIdentity $site_identity;

	public function __construct(
		?ModaApiConfiguration $configuration = null,
		?SiteIdentity $site_identity = null,
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
		$this->site_identity = $site_identity ?? new SiteIdentity( $mode );
		$this->installation_store = $installation_store ?? new InstallationStore();
		$this->api_client = $api_client ?? ( $this->configuration ? new ModaApiClient( $this->configuration ) : null );
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoutes' ) );
	}

	public function registerRoutes(): void {
		$this->registerRoute( '/billing', 'GET', 'getBilling' );
		$this->registerRoute( '/billing/plans', 'GET', 'getPlans' );
		$this->registerRoute( '/billing/subscription', 'POST', 'postSubscription' );
		$this->registerRoute( '/billing/subscription/switch', 'POST', 'postSubscriptionSwitch' );
		$this->registerRoute( '/billing/subscription/cancel', 'POST', 'postSubscriptionCancel' );
	}

	public function authorizeAdministrator(): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' ) ? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function getBilling( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! self::validRequest( $request, array() ) ) {
			return self::error( 'invalid_request', 400 );
		}
		return $this->run( fn( array $connection ) => $this->api_client->billingPresentation( $connection ) );
	}

	public function getPlans( \WP_REST_Request $request ): \WP_REST_Response {
		if ( ! self::validRequest( $request, array() ) ) {
			return self::error( 'invalid_request', 400 );
		}
		$locale = self::presentationLocale( function_exists( 'get_user_locale' ) ? (string) get_user_locale() : '' );
		return $this->run( fn( array $connection ) => $this->api_client->billingPlans( $connection, $locale ) );
	}

	public function postSubscription( \WP_REST_Request $request ): \WP_REST_Response {
		return $this->postPlanCommand( $request, 'createSubscription' );
	}

	public function postSubscriptionSwitch( \WP_REST_Request $request ): \WP_REST_Response {
		return $this->postPlanCommand( $request, 'switchSubscription' );
	}

	public function postSubscriptionCancel( \WP_REST_Request $request ): \WP_REST_Response {
		$body = $request->get_json_params();
		if ( ! self::validRequest( $request, array( 'actionId' ) ) || ! self::validActionId( $body['actionId'] ?? null ) ) {
			return self::error( 'invalid_request', 400 );
		}
		return $this->run( fn( array $connection ) => $this->api_client->cancelSubscription( $connection, $body['actionId'] ) );
	}

	private function postPlanCommand( \WP_REST_Request $request, string $method ): \WP_REST_Response {
		$body = $request->get_json_params();
		if ( ! self::validRequest( $request, array( 'actionId', 'merchantPricingPlanId' ) ) || ! self::validActionId( $body['actionId'] ?? null ) || ! self::validPlanId( $body['merchantPricingPlanId'] ?? null ) ) {
			return self::error( 'invalid_request', 400 );
		}
		return $this->run( fn( array $connection ) => $this->api_client->{$method}( $connection, $body['merchantPricingPlanId'], $body['actionId'] ) );
	}

	private function run( callable $operation ): \WP_REST_Response {
		if ( ! $this->configuration || ! $this->api_client ) {
			return self::error( 'remote_unavailable', 503 );
		}
		$local = $this->installation_store->read();
		if ( 'invalid' === $local['state'] ) {
			return self::error( 'LOCAL_STATE_INVALID', 409 );
		}
		if ( 'missing' === $local['state'] ) {
			return self::error( 'RECONNECT_REQUIRED', 401 );
		}
		try {
			if ( $this->site_identity->currentCanonicalUrl() !== $local['record']['canonicalSiteUrl'] ) {
				return self::error( 'SITE_URL_CHANGED', 409 );
			}
			$data = $operation( $local['record'] );
			return self::success( $data );
		} catch ( ModaApiClientException $error ) {
			return self::apiError( $error );
		} catch ( SiteIdentityException $error ) {
			return self::error( 'SITE_URL_CHANGED', 409 );
		} catch ( \Throwable $error ) {
			return self::error( 'remote_unavailable', 503 );
		}
	}

	private function registerRoute( string $route, string $method, string $callback ): void {
		register_rest_route( 'moda-interact/v1', $route, array(
			'methods' => $method,
			'callback' => array( $this, $callback ),
			'permission_callback' => array( $this, 'authorizeAdministrator' ),
		) );
	}

	private static function validRequest( \WP_REST_Request $request, array $body_keys ): bool {
		$query = $request->get_query_params();
		if ( array( '_locale' ) === array_keys( $query ) && 'user' === $query['_locale'] ) {
			$query = array();
		}
		$json = $request->get_json_params();
		$body = $request->get_body_params();
		if ( array() === $body_keys ) {
			return array() === $query && ( null === $json || array() === $json ) && array() === $body;
		}
		if ( array() !== $query || array() !== $body || ! is_array( $json ) ) {
			return false;
		}
		$keys = array_keys( $json );
		sort( $keys );
		sort( $body_keys );
		return $keys === $body_keys;
	}

	private static function validActionId( mixed $value ): bool {
		return is_string( $value ) && 1 === preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value );
	}

	private static function validPlanId( mixed $value ): bool {
		return is_string( $value ) && '' !== trim( $value ) && strlen( $value ) <= 128;
	}

	private static function presentationLocale( string $locale ): ?string {
		$locale = trim( $locale );
		if ( strlen( $locale ) > 64 || ! preg_match( '/^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/', $locale ) ) {
			return null;
		}
		return str_replace( '_', '-', $locale );
	}

	private static function apiError( ModaApiClientException $error ): \WP_REST_Response {
		$reason = $error->getMessage();
		$remote_error = $error->remote_error;
		if ( 'unauthorized' === $reason ) {
			return self::error( 'remote_authentication_failed', 401 );
		}
		if ( 'remote_response_invalid' === $reason ) {
			return self::error( 'remote_response_invalid', 502 );
		}
		if ( 'local_state_invalid' === $reason ) {
			return self::error( 'LOCAL_STATE_INVALID', 409 );
		}
		if ( 'billing_not_initialized' === $remote_error ) {
			return self::error( 'billing_not_initialized', 409 );
		}
		if ( 'billing_provider_outcome_unknown' === $remote_error ) {
			return self::error( 'billing_provider_outcome_unknown', 502 );
		}
		if ( 'billing_operation_failed' === $remote_error ) {
			return self::error( 'billing_operation_failed', 422 );
		}
		if ( 'remote_rejected' === $reason && 409 === $error->http_status ) {
			$conflicts = array( 'billing_operation_in_progress' => 'billing_operation_in_progress', 'billing_operation_conflict' => 'billing_operation_conflict', 'idempotency_conflict' => 'billing_operation_conflict', 'billing_plan_materialization_conflict' => 'billing_operation_conflict' );
			return self::error( $conflicts[ $remote_error ] ?? 'billing_operation_conflict', 409 );
		}
		if ( 'remote_rejected' === $reason && in_array( $error->http_status, array( 400, 413, 422 ), true ) ) {
			$plan_errors = array( 'billing_plan_unavailable', 'billing_plan_unchanged', 'subscription_create_not_allowed', 'subscription_switch_not_allowed', 'free_plan_uses_cancellation', 'no_recurring_subscription', 'billing_catalogue_mapping_invalid' );
			if ( in_array( $remote_error, $plan_errors, true ) ) {
				return self::error( 'invalid_plan_selection', 422 );
			}
			if ( in_array( $remote_error, array( 'billing_provider_outcome_unknown', 'billing_operation_failed' ), true ) ) {
				return self::error( 'billing_provider_outcome_unknown' === $remote_error ? 'billing_provider_outcome_unknown' : 'billing_operation_failed', 422 );
			}
			return self::error( 'billing_operation_failed', 422 );
		}
		return self::error( 'remote_unavailable', 503 );
	}

	private static function success( array $data ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, 200 );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}

	private static function error( string $code, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( array( 'error' => $code ), $status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}