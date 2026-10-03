<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\BootstrapAttemptStore;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\ConnectionController;
use ModaInteract\WooCommerce\Security\Base64Url;
use ModaInteract\WooCommerce\Security\HmacProof;
use PHPUnit\Framework\TestCase;

final class ConnectionControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_option_autoload'] = array();
		$GLOBALS['moda_interact_transients'] = array();
		$GLOBALS['moda_interact_scheduled_events'] = array();
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080/store';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_fail_option_writes'] = false;
		$GLOBALS['moda_interact_options']['permalink_structure'] = '/%postname%/';
	}

	public function test_connect_challenge_persists_only_server_state_then_probe_returns_safe_principal(): void {
		$controller = null;
		$api_calls  = array();
		$configuration = ModaApiConfiguration::fromServerConfiguration(
			'http://127.0.0.1:8081',
			ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT
		);
		$client = new ModaApiClient(
			$configuration,
			static function ( string $url, array $args ) use ( &$controller, &$api_calls ): array {
				$api_calls[] = array( $url, $args );
				if ( str_ends_with( $url, '/connect' ) ) {
					$body = json_decode( $args['body'], true );
					$nonce = Base64Url::encode( str_repeat( "\x05", 32 ) );
					$challenge = $controller->getChallenge( new WP_REST_Request( 'GET', array( 'attempt_id' => $body['attemptId'], 'nonce' => $nonce ) ) );
					self::assertSame( 200, $challenge->get_status() );
					$decoded_secret = Base64Url::decode( $body['bootstrapSecret'], 32 );
					self::assertSame( HmacProof::create( $decoded_secret, $body['attemptId'], $nonce, $body['siteUrl'] ), $challenge->get_data()['proof'] );
					self::assertArrayNotHasKey( 'bootstrapSecret', $challenge->get_data() );
					$payload = array(
						'installationId' => 'install_123',
						'shopId' => 'shop_456',
						'canonicalSiteUrl' => $body['siteUrl'],
						'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
						'credentialVersion' => 1,
						'connection' => 'CREATED',
					);
					return self::response( 201, $payload );
				}
				return self::response( 200, array(
					'installationId' => 'install_123',
					'shopId' => 'shop_456',
					'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080/store',
					'credentialVersion' => 1,
				) );
			}
		);
		$identity = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) );
		$controller = new ConnectionController( $configuration, $identity, new BootstrapAttemptStore(), new InstallationStore(), $client );
		$controller->registerRoutes();
		self::assertArrayHasKey( 'moda-interact/v1/connection', $GLOBALS['moda_interact_registered_rest_routes'] );
		self::assertArrayHasKey( 'moda-interact/v1/connection/challenge', $GLOBALS['moda_interact_registered_rest_routes'] );

		$post = $controller->postConnection( new WP_REST_Request( 'POST' ) );
		self::assertSame( 200, $post->get_status() );
		self::assertSame( 'CONNECTED', $post->get_data()['status'] );
		self::assertStringNotContainsString( Base64Url::encode( str_repeat( "\x07", 32 ) ), json_encode( $post->get_data() ) );
		self::assertSame( array(), $GLOBALS['moda_interact_transients'] );
		self::assertFalse( $GLOBALS['moda_interact_option_autoload'][ InstallationStore::OPTION_NAME ] );

		$get = $controller->getConnection( new WP_REST_Request( 'GET' ) );
		self::assertSame( array(
			'status' => 'CONNECTED',
			'installationId' => 'install_123',
			'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080/store',
			'credentialVersion' => 1,
		), $get->get_data() );
		self::assertArrayNotHasKey( 'Authorization', $get->get_data() );
		self::assertSame( 2, count( $api_calls ) );
		self::assertSame( 'Bearer ' . $GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ]['credential'], $api_calls[1][1]['headers']['Authorization'] );
		self::assertArrayNotHasKey( 'X-Shop-Id', $api_calls[1][1]['headers'] );
	}

	public function test_challenge_unknown_or_consumed_attempt_has_no_proof_and_connection_rejects_browser_identity(): void {
		$configuration = ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' );
		$controller = new ConnectionController( $configuration, new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '93.184.216.34' ) ) );
		$unknown = $controller->getChallenge( new WP_REST_Request( 'GET', array(
			'attempt_id' => '550e8400-e29b-41d4-a716-446655440000',
			'nonce' => Base64Url::encode( str_repeat( "\x08", 32 ) ),
		) ) );
		self::assertInstanceOf( WP_Error::class, $unknown );		self::assertSame( 'connection_attempt_invalid', $unknown->get_error_code() );

		$browser_input = new WP_REST_Request( 'POST', array(), array( 'siteUrl' => 'https://attacker.example' ) );
		$invalid = $controller->postConnection( $browser_input );
		self::assertInstanceOf( WP_Error::class, $invalid );		self::assertSame( 'invalid_request', $invalid->get_error_code() );

		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertInstanceOf( WP_Error::class, $controller->authorizeAdministrator() );
	}

	public function test_connection_routes_allow_only_wordpress_api_fetch_locale_query(): void {
		$controller = new ConnectionController();
		$get = $controller->getConnection( new WP_REST_Request( 'GET', array( '_locale' => 'user' ) ) );
		$post = $controller->postConnection( new WP_REST_Request( 'POST', array( '_locale' => 'user' ) ) );
		$identity_input = $controller->getConnection( new WP_REST_Request( 'GET', array( 'shopId' => 'browser_supplied' ) ) );
		$other_locale = $controller->getConnection( new WP_REST_Request( 'GET', array( '_locale' => 'site' ) ) );

		self::assertSame( array( 'status' => 'API_NOT_CONFIGURED' ), $get->get_data() );
		self::assertSame( array( 'status' => 'API_NOT_CONFIGURED' ), $post->get_data() );
		self::assertSame( 'invalid_request', $identity_input->get_error_code() );
		self::assertSame( 'invalid_request', $other_locale->get_error_code() );
	}

	public function test_merchant_bootstrap_route_is_privileged_and_returns_private_no_store_data(): void {
		$store = new InstallationStore();
		$record = array(
			'schemaVersion' => 1,
			'installationId' => 'install_123',
			'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080/store',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 1,
			'connectedAt' => gmdate( 'c' ),
		);
		self::assertTrue( $store->save( $record ) );
		$requests = array();
		$configuration = ModaApiConfiguration::fromServerConfiguration( 'http://127.0.0.1:8081', ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT );
		$client = new ModaApiClient( $configuration, static function ( string $url, array $args ) use ( &$requests ): array {
			$requests[] = array( $url, $args );
			return self::response( 200, self::merchantBootstrapPayload() );
		} );
		$identity = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) );
		$controller = new ConnectionController( $configuration, $identity, null, $store, $client );
		$controller->registerRoutes();
		$route = $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/bootstrap'];
		self::assertSame( 'GET', $route['methods'] );
		self::assertTrue( call_user_func( $route['permission_callback'] ) );

		$response = $controller->getMerchantBootstrap( new WP_REST_Request( 'GET', array( '_locale' => 'user' ) ) );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( self::merchantBootstrapPayload(), $response->get_data() );
		self::assertSame( 'private, no-store', $response->get_headers()['Cache-Control'] );
		self::assertSame( 'no-cache', $response->get_headers()['Pragma'] );
		self::assertSame( 'http://127.0.0.1:8081/v1/merchant/bootstrap', $requests[0][0] );
		self::assertSame( 'install_123', $requests[0][1]['headers']['X-Moda-Installation-Id'] );
		self::assertSame( 'Bearer ' . $record['credential'], $requests[0][1]['headers']['Authorization'] );
		self::assertArrayNotHasKey( 'X-Shop-Id', $requests[0][1]['headers'] );

		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertInstanceOf( WP_Error::class, call_user_func( $route['permission_callback'] ) );
	}

	public function test_merchant_bootstrap_route_rejects_browser_identity_and_site_url_mismatch_without_api_call(): void {
		$store = new InstallationStore();
		self::assertTrue( $store->save( array(
			'schemaVersion' => 1,
			'installationId' => 'install_123',
			'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080/store',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 1,
			'connectedAt' => gmdate( 'c' ),
		) ) );
		$called = false;
		$configuration = ModaApiConfiguration::fromServerConfiguration( 'http://127.0.0.1:8081', ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT );
		$client = new ModaApiClient( $configuration, static function () use ( &$called ): array {
			$called = true;
			return self::response( 200, self::merchantBootstrapPayload() );
		} );
		$identity = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) );
		$controller = new ConnectionController( $configuration, $identity, null, $store, $client );

		$browser_identity = $controller->getMerchantBootstrap( new WP_REST_Request( 'GET', array( 'shopId' => 'attacker' ) ) );
		self::assertSame( 400, $browser_identity->get_status() );
		self::assertSame( array( 'error' => 'MERCHANT_BOOTSTRAP_UNAVAILABLE' ), $browser_identity->get_data() );
		$GLOBALS['moda_interact_home_url'] = 'http://cloned-site.local';
		$changed_site = $controller->getMerchantBootstrap( new WP_REST_Request( 'GET' ) );
		self::assertSame( 409, $changed_site->get_status() );
		self::assertSame( array( 'error' => 'SITE_URL_CHANGED' ), $changed_site->get_data() );
		self::assertSame( 'private, no-store', $changed_site->get_headers()['Cache-Control'] );
		self::assertFalse( $called );
	}

	public function test_invalid_server_api_mode_disables_connection_without_breaking_controller_initialization(): void {
		putenv( 'MODA_INTERACT_API_BASE_URL=https://api.example.test' );
		putenv( 'MODA_INTERACT_CONNECTION_MODE=invalid-mode' );
		try {
			$controller = new ConnectionController();
			$result = $controller->getConnection( new WP_REST_Request( 'GET' ) );
			self::assertSame( array( 'status' => 'API_NOT_CONFIGURED' ), $result->get_data() );
		} finally {
			putenv( 'MODA_INTERACT_API_BASE_URL' );
			putenv( 'MODA_INTERACT_CONNECTION_MODE' );
		}
	}

	public function test_site_url_change_blocks_credential_use_and_remote_outage_is_not_disconnected(): void {
		$store = new InstallationStore();
		$record = array(
			'schemaVersion' => 1,
			'installationId' => 'install_123',
			'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080/store',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 1,
			'connectedAt' => gmdate( 'c' ),
		);
		self::assertTrue( $store->save( $record ) );
		$called = false;
		$configuration = ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' );
		$client = new ModaApiClient( $configuration, static function () use ( &$called ): array {
			$called = true;
			return array();
		} );
		$identity = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) );
		$controller = new ConnectionController( $configuration, $identity, null, $store, $client );
		$GLOBALS['moda_interact_home_url'] = 'http://new-site.local';
		$changed = $controller->getConnection( new WP_REST_Request( 'GET' ) );
		self::assertSame( array( 'status' => 'SITE_URL_CHANGED' ), $changed->get_data() );
		self::assertFalse( $called );

		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080/store';
		$outage_client = new ModaApiClient( $configuration, static fn() => new WP_Error( 'http_request_failed', 'private detail' ) );
		$outage = new ConnectionController( $configuration, $identity, null, $store, $outage_client );
		$state = $outage->getConnection( new WP_REST_Request( 'GET' ) );
		self::assertSame( array( 'status' => 'REMOTE_UNAVAILABLE' ), $state->get_data() );
		self::assertSame( $record, $store->read()['record'] );
	}

	public function test_persistence_failure_keeps_previous_connection_and_never_returns_new_credential(): void {
		$GLOBALS['moda_interact_options']['moda_interact_onboarding'] = array( 'state' => 'in_progress' );
		$store = new InstallationStore();
		$previous = array(
			'schemaVersion' => 1,
			'installationId' => 'install_previous',
			'shopId' => 'shop_previous',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080/store',
			'credential' => Base64Url::encode( str_repeat( "\x06", 32 ) ),
			'credentialVersion' => 4,
			'connectedAt' => gmdate( 'c' ),
		);
		self::assertTrue( $store->save( $previous ) );
		$configuration = ModaApiConfiguration::fromServerConfiguration(
			'http://127.0.0.1:8081',
			ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT
		);
		$client = new ModaApiClient( $configuration, static fn() => self::response( 200, array(
			'installationId' => 'install_new',
			'shopId' => 'shop_new',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080/store',
			'credential' => Base64Url::encode( str_repeat( "\x09", 32 ) ),
			'credentialVersion' => 5,
			'connection' => 'RECONNECTED',
		) ) );
		$controller = new ConnectionController(
			$configuration,
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ),
			new BootstrapAttemptStore(),
			$store,
			$client
		);
		$GLOBALS['moda_interact_fail_option_writes'] = true;
		$result = $controller->postConnection( new WP_REST_Request( 'POST' ) );
		$GLOBALS['moda_interact_fail_option_writes'] = false;

		self::assertSame( 500, $result->get_status() );
		self::assertSame( array( 'status' => 'LOCAL_PERSISTENCE_FAILED' ), $result->get_data() );
		self::assertSame( $previous, $store->read()['record'] );
		self::assertStringNotContainsString( Base64Url::encode( str_repeat( "\x09", 32 ) ), json_encode( $result->get_data() ) );
		self::assertSame( array(), $GLOBALS['moda_interact_transients'] );
		self::assertSame( array( 'state' => 'in_progress' ), $GLOBALS['moda_interact_options']['moda_interact_onboarding'] );

		$retry = $controller->postConnection( new WP_REST_Request( 'POST' ) );
		self::assertSame( 'CONNECTED', $retry->get_data()['status'] );
		self::assertSame( 'install_new', $store->read()['record']['installationId'] );
		self::assertSame( array( 'state' => 'in_progress' ), $GLOBALS['moda_interact_options']['moda_interact_onboarding'] );
	}

	private static function response( int $status, array $payload ): array {
		return array(
			'headers' => array( 'content-type' => 'application/json; charset=utf-8' ),
			'body' => json_encode( $payload ),
			'response' => array( 'code' => $status ),
		);
	}

	private static function merchantBootstrapPayload(): array {
		return array(
			'schemaVersion' => 1,
			'shop' => array(
				'id' => 'shop_456',
				'platform' => 'WOOCOMMERCE',
				'domain' => 'https://merchant.example',
				'onboardingCompleted' => false,
				'installedAt' => '2026-10-03T12:00:00.000Z',
			),
			'internationalContext' => array(
				'storeLocale' => null,
				'languageTag' => null,
				'timeZone' => null,
				'countryCode' => null,
			),
			'storeProfile' => array(
				'activeCategory' => null,
				'pendingCategory' => null,
				'pendingSelectionGeneration' => 0,
				'pendingSelectedAt' => null,
			),
		);
	}
}