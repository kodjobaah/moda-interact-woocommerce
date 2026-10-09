<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\BillingController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class BillingControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_option_autoload'] = array();
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080/store';
		$GLOBALS['moda_interact_user_locale'] = 'en_GB';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
	}

	public function test_provider_outcome_and_operation_errors_keep_their_bounded_codes(): void {
		$requests = array();
		$controller = $this->controller( $requests, array(), 502, array( 'error' => 'billing_provider_outcome_unknown' ) );
		$response  = $controller->getBilling( new WP_REST_Request( 'GET' ) );
		self::assertSame( 'billing_provider_outcome_unknown', $response->get_data()['error'] );
		self::assertSame( 502, $response->get_status() );

		$controller = $this->controller( $requests, array(), 500, array( 'error' => 'billing_operation_failed' ) );
		$response  = $controller->getBilling( new WP_REST_Request( 'GET' ) );
		self::assertSame( 'billing_operation_failed', $response->get_data()['error'] );
		self::assertSame( 422, $response->get_status() );
	}
	public function test_registers_exact_privileged_routes_and_maps_only_bounded_request_fields(): void {
		$requests = array();
		$responses = array( self::billing(), self::plans(), self::confirmation(), self::cancellation() );
		$controller = $this->controller( $requests, $responses );
		$controller->registerRoutes();
		$routes = $GLOBALS['moda_interact_registered_rest_routes'];
		self::assertSame( array(
			'moda-interact/v1/billing',
			'moda-interact/v1/billing/plans',
			'moda-interact/v1/billing/subscription',
			'moda-interact/v1/billing/subscription/switch',
			'moda-interact/v1/billing/subscription/cancel',
		), array_keys( $routes ) );
		foreach ( $routes as $route ) {
			self::assertSame( array( $controller, 'authorizeAdministrator' ), $route['permission_callback'] );
			self::assertTrue( call_user_func( $route['permission_callback'] ) );
		}
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertInstanceOf( WP_Error::class, $controller->authorizeAdministrator() );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;

		self::assertSame( self::billing(), $controller->getBilling( new WP_REST_Request( 'GET', array( '_locale' => 'user' ) ) )->get_data() );
		self::assertSame( self::plans(), $controller->getPlans( new WP_REST_Request( 'GET', array( '_locale' => 'user' ) ) )->get_data() );
		$action_id = '550e8400-e29b-41d4-a716-446655440000';
		self::assertSame( 'AWAITING_CONFIRMATION', $controller->postSubscription( new WP_REST_Request( 'POST', array( '_locale' => 'user' ), array( 'merchantPricingPlanId' => 'plan_1', 'actionId' => $action_id ) ) )->get_data()['state'] );
		self::assertSame( 'CONFIRMED', $controller->postSubscriptionCancel( new WP_REST_Request( 'POST', array(), array( 'actionId' => $action_id ) ) )->get_data()['state'] );

		self::assertSame( 'https://api.example.test/v1/billing', $requests[0][0] );
		self::assertSame( 'https://api.example.test/v1/billing/plans?locale=en-GB', $requests[1][0] );
		self::assertSame( $action_id, $requests[2][1]['headers']['Idempotency-Key'] );
		self::assertSame( array( 'merchantPricingPlanId' => 'plan_1' ), json_decode( $requests[2][1]['body'], true ) );
		self::assertArrayNotHasKey( 'actionId', json_decode( $requests[2][1]['body'], true ) );
		self::assertSame( 'DELETE', $requests[3][1]['method'] );
		self::assertArrayNotHasKey( 'body', $requests[3][1] );
		foreach ( $requests as $request ) {
			self::assertArrayNotHasKey( 'shopId', $request[1]['headers'] );
			self::assertArrayNotHasKey( 'domain', $request[1]['headers'] );
		}
	}

	public function test_rejects_browser_tenant_identity_and_non_v4_action_ids_before_remote_call(): void {
		$requests = array();
		$controller = $this->controller( $requests, array() );
		$tenant = $controller->getBilling( new WP_REST_Request( 'GET', array( 'shopId' => 'attacker' ) ) );
		$bad_action = $controller->postSubscription( new WP_REST_Request( 'POST', array(), array( 'merchantPricingPlanId' => 'plan_1', 'actionId' => 'not-a-uuid' ) ) );
		self::assertSame( 400, $tenant->get_status() );
		self::assertSame( array( 'error' => 'invalid_request' ), $tenant->get_data() );
		self::assertSame( 'private, no-store', $tenant->get_headers()['Cache-Control'] );
		self::assertSame( 400, $bad_action->get_status() );
		self::assertSame( array(), $requests );
	}

	public function test_maps_recognized_hosted_billing_errors_without_relaying_remote_details(): void {
		$requests = array();
		$controller = $this->controller( $requests, array(), 409, array( 'error' => 'billing_operation_in_progress', 'message' => 'provider internal details' ) );
		$response = $controller->getBilling( new WP_REST_Request( 'GET' ) );
		self::assertSame( 409, $response->get_status() );
		self::assertSame( array( 'error' => 'billing_operation_in_progress' ), $response->get_data() );
		self::assertSame( 'private, no-store', $response->get_headers()['Cache-Control'] );
	}

	public function test_requires_valid_local_connection_and_matching_site_before_hosted_call(): void {
		$store = new InstallationStore();
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), static function () {
			self::fail( 'Hosted API must not be called without local connection.' );
		} );
		$controller = new BillingController(
			ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ),
			$store,
			$client
		);
		self::assertSame( array( 'error' => 'RECONNECT_REQUIRED' ), $controller->getBilling( new WP_REST_Request( 'GET' ) )->get_data() );
	}

	public function test_omits_invalid_presentation_locale_and_rejects_changed_site_identity(): void {
		$GLOBALS['moda_interact_user_locale'] = 'locale with spaces';
		$requests = array();
		$controller = $this->controller( $requests, array( self::plans() ) );
		$controller->getPlans( new WP_REST_Request( 'GET' ) );
		self::assertSame( 'https://api.example.test/v1/billing/plans', $requests[0][0] );

		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080/moved';
		$response = $controller->getBilling( new WP_REST_Request( 'GET' ) );
		self::assertSame( 409, $response->get_status() );
		self::assertSame( array( 'error' => 'SITE_URL_CHANGED' ), $response->get_data() );
		self::assertCount( 1, $requests );
	}

	private function controller( array &$requests, array $responses, int $remote_status = 200, ?array $remote_error = null ): BillingController {
		$record = array( 'schemaVersion' => 1, 'installationId' => 'install_1', 'shopId' => 'shop_1', 'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080/store', 'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ), 'credentialVersion' => 1, 'connectedAt' => gmdate( 'c' ) );
		$store = new InstallationStore();
		self::assertTrue( $store->save( $record ) );
		$configuration = ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' );
		$client = new ModaApiClient( $configuration, static function ( string $url, array $args ) use ( &$requests, &$responses, $remote_status, $remote_error ): array {
			$requests[] = array( $url, $args );
			$body = null !== $remote_error ? $remote_error : array_shift( $responses );
			return array( 'headers' => array( 'content-type' => 'application/json' ), 'body' => wp_json_encode( $body ), 'response' => array( 'code' => 200 !== $remote_status ? $remote_status : ( 'DELETE' === $args['method'] ? 200 : ( 'POST' === $args['method'] ? 202 : 200 ) ) ) );
		} );
		$identity = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) );
		return new BillingController( $configuration, $identity, $store, $client );
	}

	private static function billing(): array {
		return array( 'schemaVersion' => 1, 'experienceState' => 'ACTIVE', 'surfaces' => array( 'usageHistoryAllowed' => true, 'purchaseHistoryAllowed' => true, 'managePlansAllowed' => true, 'cancelSubscriptionAllowed' => false ), 'currentPlan' => array( 'merchantPricingPlanId' => 'plan_free', 'displayName' => 'Free', 'planKind' => 'FREE', 'recurringAmountMinor' => 0, 'currency' => 'USD', 'billingPeriod' => 'EVERY_30_DAYS', 'currentPeriodEnd' => null, 'cancelAtPeriodEnd' => false, 'cancellationEffectiveAt' => null ), 'pendingPlan' => null, 'pendingCancellation' => null, 'capacity' => array( 'paidIncluded' => null, 'freeLifetime' => array( 'granted' => 2, 'committed' => 0, 'reserved' => 0, 'remaining' => 2 ), 'promotional' => array( 'granted' => 0, 'committed' => 0, 'reserved' => 0, 'remaining' => 0 ), 'purchased' => array( 'granted' => 0, 'committed' => 0, 'reserved' => 0, 'refunding' => 0, 'available' => 0 ) ), 'topUps' => array( 'configured' => false, 'purchaseEligible' => false, 'offers' => array(), 'latestPurchase' => null, 'unresolvedPurchases' => array() ) );
	}

	private static function plans(): array {
		return array( 'schemaVersion' => 1, 'resolvedLocale' => 'en-GB', 'plans' => array() );
	}

	private static function confirmation(): array {
		return array( 'schemaVersion' => 1, 'operationId' => 'op_1', 'kind' => 'SUBSCRIPTION_CREATE', 'state' => 'AWAITING_CONFIRMATION', 'confirmationUrl' => 'https://woocommerce.com/confirm/1' );
	}

	private static function cancellation(): array {
		return array( 'schemaVersion' => 1, 'operationId' => 'op_2', 'kind' => 'CANCEL', 'state' => 'CONFIRMED', 'confirmationUrl' => null );
	}
}