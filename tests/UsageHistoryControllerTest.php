<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\UsageHistoryResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\UsageHistoryController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class UsageHistoryControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_get_only_capability_nonce_and_no_store(): void {
		$calls = array();
		$controller = $this->controller( $calls );
		$controller->registerRoutes();
		$route = $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/usage-history'];
		self::assertSame( 'GET', $route['methods'] );
		$request = new WP_REST_Request( 'GET', array( '_locale' => 'user' ) );
		self::assertTrue( $controller->authorizeAdministrator( $request ) );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( $request )->get_error_data()['status'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$request->set_header( 'X-WP-Nonce', 'invalid' );
		self::assertSame( 403, $controller->authorizeAdministrator( $request )->get_error_data()['status'] );
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( new WP_REST_Request( 'GET' ) )->get_error_data()['status'] );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$result = $controller->read( new WP_REST_Request( 'GET', array( '_locale' => 'user' ) ) );
		self::assertSame( 200, $result->get_status() );
		self::assertSame( 'private, no-store', $result->get_headers()['Cache-Control'] );
		self::assertSame( 'no-referrer', $result->get_headers()['Referrer-Policy'] );
		self::assertCount( 1, $calls );
	}

	public function test_proxies_only_bounded_filters_with_server_held_credentials(): void {
		$calls = array();
		$controller = $this->controller( $calls, self::history( 'past', 100 ) );
		$query = array( '_locale' => 'user', 'view' => 'past', 'periodId' => 'period_1',
			'kind' => 'RECOVERY_CONVERSATION', 'page' => '1', 'pageSize' => '100', 'periodCursor' => 'signedCursor' );
		$result = $controller->read( new WP_REST_Request( 'GET', $query ) );
		self::assertSame( 200, $result->get_status() );
		self::assertSame( self::history( 'past', 100 ), $result->get_data() );
		self::assertCount( 1, $calls );
		self::assertSame( 'GET', $calls[0][1]['method'] );
		self::assertSame( 0, $calls[0][1]['redirection'] );
		self::assertSame( 262145, $calls[0][1]['limit_response_size'] );
		self::assertArrayNotHasKey( 'body', $calls[0][1] );
		self::assertSame( 'Bearer ' . self::installation()['credential'], $calls[0][1]['headers']['Authorization'] );
		self::assertSame( 'install_1', $calls[0][1]['headers']['X-Moda-Installation-Id'] );
		self::assertSame( '/v1/merchant/usage-history', parse_url( $calls[0][0], PHP_URL_PATH ) );
		$sent = array();
		parse_str( (string) parse_url( $calls[0][0], PHP_URL_QUERY ), $sent );
		unset( $query['_locale'] );
		self::assertSame( array_merge( $query, array( 'responseVersion' => '2' ) ), $sent );
		self::assertArrayNotHasKey( 'shopId', $sent );
	}

	public function test_rejects_tampered_filters_and_body_without_hosted_requests(): void {
		$calls = array();
		$controller = $this->controller( $calls );
		foreach ( array(
			array( 'shopId' => 'foreign' ), array( 'provider' => 'SHOPIFY' ),
			array( '_locale' => 'de_DE' ), array( 'view' => 'somewhere' ),
			array( 'pageSize' => '5' ), array( 'pageSize' => '1000' ),
			array( 'page' => '1001' ), array( 'page' => '0' ),
			array( 'page' => array( '1', '2' ) ), array( 'kind' => 'PURCHASE' ),
			array( 'periodId' => '../foreign' ), array( 'periodId' => str_repeat( 'a', 129 ) ),
			array( 'periodCursor' => str_repeat( 'b', 1025 ) ),
			array( 'responseVersion' => '1' ), array( 'responseVersion' => '2' ),
		) as $query ) {
			self::assertSame( 400, $controller->read( new WP_REST_Request( 'GET', $query ) )->get_status() );
		}
		self::assertSame( 400, $controller->read( new WP_REST_Request( 'POST' ) )->get_status() );
		self::assertSame( 400, $controller->read( new WP_REST_Request( 'GET', array(), array( 'x' => 'y' ) ) )->get_status() );
		self::assertCount( 0, $calls );
	}

	public function test_real_empty_and_free_lifetime_history_are_valid_without_synthetic_periods(): void {
		$free = self::history();
		$free['periodPage']['items'] = array();
		$free['periodPage']['nextCursor'] = null;
		$free['usagePagination']['billId'] = null;
		$free['usagePagination']['periodStart'] = null;
		$free['usagePagination']['periodEnd'] = null;
		$free['usageEvents'][0]['quantity'] = -2;
		$free['usageEvents'][0]['chargedAgainst'] = 'LIFETIME_FREE_CREDITS';
		$free['usagePagination']['totalQuantity'] = -2;
		self::assertTrue( UsageHistoryResponseValidator::isValid( $free ) );
		$calls = array();
		self::assertSame( $free, $this->controller( $calls, $free )->read( new WP_REST_Request() )->get_data() );
		$free['usageEvents'] = array();
		$free['usagePagination']['total'] = 0;
		$free['usagePagination']['totalQuantity'] = 0;
		self::assertTrue( UsageHistoryResponseValidator::isValid( $free ) );
		self::assertSame( $free, $this->controller( $calls, $free )->read( new WP_REST_Request() )->get_data() );
	}

	public function test_v1_and_v2_charge_attribution_validation_remains_strict(): void {
		$v1 = self::history( 'current', 10, 1 );
		$v2 = self::history();
		self::assertTrue( UsageHistoryResponseValidator::isValid( $v1 ) );
		self::assertTrue( UsageHistoryResponseValidator::isValid( $v2 ) );
		self::assertFalse( UsageHistoryResponseValidator::isValid( array_replace_recursive( $v1, array(
			'usageEvents' => array( array_merge( $v1['usageEvents'][0], array( 'chargedAgainst' => 'LIFETIME_FREE_CREDITS' ) ) ),
		) ) ) );
		foreach ( array( 'LIFETIME_FREE_CREDITS', 'INCLUDED_PLAN_ALLOWANCE', 'PURCHASED_TOP_UP',
			'PROMOTIONAL_CREDITS', 'NOT_APPLICABLE', 'UNATTRIBUTED' ) as $label ) {
			$v2['usageEvents'][0]['chargedAgainst'] = $label;
			self::assertTrue( UsageHistoryResponseValidator::isValid( $v2 ), $label );
		}
		foreach ( array( 'purchasedCreditPurchaseId', 'shopId', 'apiCredential' ) as $extra ) {
			$invalid = $v2;
			$invalid['usageEvents'][0][$extra] = 'secret';
			self::assertFalse( UsageHistoryResponseValidator::isValid( $invalid ) );
		}
		foreach ( array( 'PAID', '', 'purchased_top_up', null, 4 ) as $bad ) {
			$v2['usageEvents'][0]['chargedAgainst'] = $bad;
			self::assertFalse( UsageHistoryResponseValidator::isValid( $v2 ) );
		}
		$v2['usageEvents'][0]['chargedAgainst'] = 'UNATTRIBUTED';
		$v2['usageEvents'][0]['metric'] = 'UNKNOWN_NEW_METRIC';
		self::assertFalse( UsageHistoryResponseValidator::isValid( $v2 ) );
		$v2['usageEvents'][0]['metric'] = 'RECOVERY_CONVERSATION';
		unset( $v2['usageEvents'][0]['chargedAgainst'] );
		self::assertFalse( UsageHistoryResponseValidator::isValid( $v2 ) );
		$v2['usageEvents'] = array();
		$v2['usagePagination']['total'] = 0;
		$v2['usagePagination']['totalQuantity'] = 0;
		self::assertTrue( UsageHistoryResponseValidator::isValid( $v2 ) );
	}

	public function test_unsupported_v2_retries_only_once_with_valid_v1_projection(): void {
		$calls = array();
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function ( string $url, array $args ) use ( &$calls ): array {
				$calls[] = array( $url, $args );
				parse_str( (string) parse_url( $url, PHP_URL_QUERY ), $query );
				return isset( $query['responseVersion'] )
					? self::response( 400, array( 'error' => 'invalid_request' ) )
					: self::response( 200, self::history( 'current', 10, 1 ) );
			} );
		$read = $client->merchantUsageHistory( self::installation(), array( 'view' => 'current' ) );
		self::assertSame( 1, $read['schemaVersion'] );
		self::assertCount( 2, $calls );
		self::assertStringContainsString( 'responseVersion=2', $calls[0][0] );
		self::assertStringNotContainsString( 'responseVersion', $calls[1][0] );
	}

	public function test_mismatched_response_version_fails_closed_without_fallback(): void {
		$calls = array();
		$controller = $this->controller( $calls, self::history( 'current', 10, 1 ) );
		$result = $controller->read( new WP_REST_Request() );
		self::assertSame( 502, $result->get_status() );
		self::assertSame( array( 'status' => 'REMOTE_RESPONSE_INVALID' ), $result->get_data() );
		self::assertCount( 1, $calls );
	}

	public function test_fails_closed_on_malformed_hosted_projection_and_foreign_fields(): void {
		$valid = self::history();
		self::assertTrue( UsageHistoryResponseValidator::isValid( $valid ) );
		foreach ( array(
			array_merge( $valid, array( 'shopId' => 'foreign' ) ),
			array_replace_recursive( $valid, array( 'usagePagination' => array( 'totalQuantity' => null ) ) ),
			array_replace_recursive( $valid, array( 'usageEvents' => array( array_merge( $valid['usageEvents'][0], array( 'credential' => 'secret' ) ) ) ) ),
			array_replace_recursive( $valid, array( 'usageEvents' => array( array_merge( $valid['usageEvents'][0], array( 'sourceRecovery' => array( 'recoveryId' => '../foreign', 'customerName' => 'Leak' ) ) ) ) ) ),
		) as $invalid ) {
			self::assertFalse( UsageHistoryResponseValidator::isValid( $invalid ) );
			$calls = array();
			$result = $this->controller( $calls, $invalid )->read( new WP_REST_Request() );
			self::assertSame( 502, $result->get_status() );
			self::assertSame( array( 'status' => 'REMOTE_RESPONSE_INVALID' ), $result->get_data() );
		}
	}

	public function test_maps_hosted_denials_invalid_cursors_and_outages(): void {
		foreach ( array(
			array( 401, 'unauthorized', 'RECONNECT_REQUIRED', 401 ),
			array( 403, 'forbidden', 'USAGE_HISTORY_DENIED', 403 ),
			array( 409, 'invalid_cursor', 'INVALID_CURSOR', 409 ),
			array( 400, 'invalid_period', 'INVALID_PERIOD', 409 ),
			array( 409, 'tenant_conflict', 'RECONNECT_REQUIRED', 409 ),
			array( 500, 'internal_error', 'REMOTE_UNAVAILABLE', 503 ),
		) as $case ) {
			$calls = array();
			$controller = $this->controller( $calls, array( 'error' => $case[1] ), $case[0] );
			$result = $controller->read( new WP_REST_Request() );
			self::assertSame( $case[3], $result->get_status() );
			self::assertSame( array( 'status' => $case[2] ), $result->get_data() );
			self::assertCount( 1, $calls );
		}
	}

	public function test_disconnect_credential_rotation_and_site_change_block_stale_data(): void {
		$calls = array();
		$controller = $this->controller( $calls );
		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 401, $controller->read( new WP_REST_Request() )->get_status() );
		self::assertCount( 0, $calls );

		$store = new InstallationStore();
		$store->save( self::installation() );
		$GLOBALS['moda_interact_home_url'] = 'http://different-site.local:8080';
		self::assertSame( 'SITE_URL_CHANGED', $controller->read( new WP_REST_Request() )->get_data()['status'] );
		self::assertCount( 0, $calls );
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		foreach ( array( 'disconnect', 'rotate' ) as $mode ) {
			$store->save( self::installation() );
			$requests = array();
			$controller = $this->controller( $requests, self::history(), 200, function () use ( $store, $mode ): void {
				if ( 'disconnect' === $mode ) delete_option( InstallationStore::OPTION_NAME );
				else $store->save( array_merge( self::installation(), array( 'credentialVersion' => 3 ) ) );
			} );
			$response = $controller->read( new WP_REST_Request() );
			self::assertSame( 409, $response->get_status() );
			self::assertSame( array( 'status' => 'RECONNECT_REQUIRED' ), $response->get_data() );
			self::assertCount( 1, $requests );
		}
	}

	public function test_client_does_not_accept_foreign_shop_query_even_when_called_directly(): void {
		$calls = array();
		$this->controller( $calls );
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function () use ( &$calls ): array { $calls[] = true; return self::response( 200, self::history() ); } );
		try {
			$client->merchantUsageHistory( self::installation(), array( 'shopId' => 'other' ) );
			self::fail( 'Foreign tenant input must be rejected.' );
		} catch ( ModaApiClientException $error ) {
			self::assertSame( 'invalid_request', $error->getMessage() );
		}
		self::assertCount( 0, $calls );
	}

	private function controller( array &$calls, ?array $body = null, int $status = 200, ?callable $during_request = null ): UsageHistoryController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::installation() ) );
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function ( string $url, array $args ) use ( &$calls, $body, $status, $during_request ): array {
				$calls[] = array( $url, $args );
				if ( null !== $during_request ) $during_request();
				return self::response( $status, $body ?? self::history() );
			} );
		return new UsageHistoryController( $client, new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ), $store );
	}

	private static function installation(): array {
		return array(
			'schemaVersion' => 1, 'installationId' => 'install_1', 'shopId' => 'shop_1',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2, 'connectedAt' => '2026-10-03T12:00:00+00:00',
		);
	}

	private static function history( string $view = 'current', int $size = 10, int $version = 2 ): array {
		$event = array(
			'id' => 'event_1', 'metric' => 'RECOVERY_CONVERSATION', 'quantity' => 1,
			'occurredAt' => '2026-10-14T10:00:00.000Z',
			'sourceRecovery' => array( 'recoveryId' => 'recovery_1', 'customerName' => 'Jane <script>Doe</script>' ),
		);
		if ( 2 === $version ) $event['chargedAgainst'] = 'INCLUDED_PLAN_ALLOWANCE';
		return array(
			'schemaVersion' => $version, 'state' => 'ready', 'usageView' => $view,
			'periodPage' => array( 'items' => array( array(
				'id' => 'period_1', 'periodStart' => '2026-10-01T00:00:00.000Z',
				'periodEnd' => '2026-10-31T00:00:00.000Z',
			) ), 'previousCursor' => null, 'nextCursor' => null ),
			'usagePagination' => array(
				'page' => 1, 'pageSize' => $size, 'total' => 1, 'totalQuantity' => 1,
				'billId' => 'period_1', 'periodStart' => '2026-10-01T00:00:00.000Z',
				'periodEnd' => '2026-10-31T00:00:00.000Z',
			),
			'usageEvents' => array( $event ),
		);
	}

	private static function response( int $status, array $payload ): array {
		return array( 'headers' => array( 'content-type' => 'application/json' ),
			'body' => wp_json_encode( $payload ), 'response' => array( 'code' => $status ) );
	}
}
