<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\RestReadResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\ReadAccessController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class ReadAccessControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_admin_only_methods_require_nonce(): void {
		$controller = $this->controller( static fn() => self::response( 200, self::readAccessStatus() ) );
		$controller->registerRoutes();
		$routes = $GLOBALS['moda_interact_registered_rest_routes'];
		self::assertCount( 2, $routes['moda-interact/v1/connection/read-access'] );
		self::assertSame( 'GET', $routes['moda-interact/v1/connection/read-access'][0]['methods'] );
		self::assertSame( 'DELETE', $routes['moda-interact/v1/connection/read-access'][1]['methods'] );
		self::assertSame( 'POST', $routes['moda-interact/v1/connection/read-access/authorize']['methods'] );
		$request = new \WP_REST_Request( 'GET' );
		self::assertTrue( $controller->authorizeAdministrator( $request ) );
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( $request )->get_error_data()['status'] );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( $request )->get_error_data()['status'] );
	}

	public function test_start_uses_read_only_native_url_and_never_exposes_credentials(): void {
		$seen = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$seen ) {
			$seen = array( $url, $args );
			return self::response( 201, self::start() );
		} );
		$result = $controller->start( new \WP_REST_Request( 'POST' ) );
		self::assertSame( 201, $result->get_status() );
		self::assertSame( self::start(), $result->get_data() );
		self::assertSame( 'https://api.example.test/v1/woocommerce/read-authorizations', $seen[0] );
		self::assertSame( 'POST', $seen[1]['method'] );
		self::assertSame( 'Bearer ' . self::record()['credential'], $seen[1]['headers']['Authorization'] );
		self::assertStringNotContainsString( 'credential', json_encode( $result->get_data() ) );
		self::assertSame( 'private, no-store', $result->get_headers()['Cache-Control'] );
	}

	public function test_status_and_revoke_stay_distinct_from_inbound_installation(): void {
		$methods = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$methods ) {
			$methods[] = $args['method'];
			return $args['method'] === 'DELETE'
				? self::response( 200, array( 'schemaVersion' => 1, 'status' => 'REVOKED', 'providerRevocationRequired' => true ) )
				: self::response( 200, self::readAccessStatus() );
		} );
		self::assertSame( 'CONNECTED', $controller->status( new \WP_REST_Request() )->get_data()['status'] );
		self::assertSame( 'REVOKED', $controller->revoke( new \WP_REST_Request( 'DELETE' ) )->get_data()['status'] );
		self::assertSame( array( 'GET', 'DELETE' ), $methods );
		self::assertSame( self::record(), ( new InstallationStore() )->read()['record'] );
	}

	public function test_rejects_caller_shop_ids_and_untrusted_provider_url(): void {
		$calls = 0;
		$controller = $this->controller( static function ( $url, $args ) use ( &$calls ) {
			$calls++;
			return self::response( 201, array_merge( self::start(), array( 'authorizationUrl' => 'https://attacker.example/wc-auth/v1/authorize?scope=read' ) ) );
		} );
		self::assertSame( 400, $controller->start( new \WP_REST_Request( 'POST', array( 'shopId' => 'other-shop' ) ) )->get_status() );
		self::assertSame( 0, $calls );
		self::assertSame( 'REMOTE_RESPONSE_INVALID', $controller->start( new \WP_REST_Request( 'POST' ) )->get_data()['status'] );
	}

	public function test_local_loopback_http_callback_is_allowed_only_in_local_development(): void {
		$start = self::start();
		$parts = explode( '?', $start['authorizationUrl'], 2 );
		self::assertCount( 2, $parts );
		parse_str( $parts[1], $parameters );
		$parameters['return_url'] = 'http://127.0.0.1:3100/v1/woocommerce/read-authorizations/return';
		$parameters['callback_url'] = 'http://127.0.0.1:3100/v1/woocommerce/read-authorizations/callback/' . str_repeat( 'a', 43 );
		$start['authorizationUrl'] = $parts[0] . '?' . http_build_query( $parameters );
		self::assertStringContainsString( 'return_url=http%3A%2F%2F127.0.0.1%3A3100', $start['authorizationUrl'] );
		self::assertTrue( RestReadResponseValidator::start( $start, self::record()['canonicalSiteUrl'], ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT ) );
		self::assertFalse( RestReadResponseValidator::start( $start, self::record()['canonicalSiteUrl'], ModaApiConfiguration::MODE_PUBLIC ) );
	}

	private function controller( callable $transport ): ReadAccessController {
		$store = new InstallationStore();
		$store->save( self::record() );
		return new ReadAccessController(
			new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport ),
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ),
			$store
		);
	}

	private static function record(): array {
		return array(
			'schemaVersion' => 1, 'installationId' => 'install_123', 'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2, 'connectedAt' => '2026-10-03T12:00:00+00:00',
		);
	}

	private static function readAccessStatus(): array {
		return array( 'schemaVersion' => 1, 'status' => 'CONNECTED', 'providerRevocationRequired' => false );
	}

	private static function start(): array {
		$query = http_build_query( array(
			'app_name' => 'Moda Interact', 'scope' => 'read',
			'user_id' => 'cmg8d0fbj0000abc0asf8421q',
			'return_url' => 'https://api.example.test/v1/woocommerce/read-authorizations/return',
			'callback_url' => 'https://api.example.test/v1/woocommerce/read-authorizations/callback/' . str_repeat( 'a', 43 ),
		) );
		return array(
			'schemaVersion' => 1,
			'authorizationUrl' => 'http://woocommerce-sandbox.local:8080/wc-auth/v1/authorize?' . $query,
			'expiresAt' => '2026-10-10T13:00:00.000Z',
		);
	}

	private static function response( int $status, array $payload ): array {
		return array(
			'headers' => array( 'content-type' => 'application/json' ),
			'body' => json_encode( $payload ),
			'response' => array( 'code' => $status ),
		);
	}
}
