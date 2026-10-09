<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\StoreContextController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class StoreContextControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array( 'timezone_string' => 'Europe/London', 'WPLANG' => 'en_GB' );
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_store_locale'] = 'en_GB';
		$GLOBALS['moda_interact_base_location'] = array( 'country' => 'GB' );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_registers_privileged_no_body_route_and_forbids_unauthorized_users(): void {
		$controller = $this->controller( 204 );
		$controller->registerRoutes();
		$registered = $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/store-context/sync'];
		self::assertSame( 'POST', $registered['methods'] );
		self::assertSame( array( $controller, 'authorizeAdministrator' ), $registered['permission_callback'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertInstanceOf( \WP_Error::class, $controller->authorizeAdministrator() );
		self::assertSame( 403, $controller->authorizeAdministrator()->get_error_data()['status'] );
	}

	public function test_sync_sends_only_native_settings_and_does_not_mutate_installation(): void {
		$requests = array();
		$client = $this->client( static function ( string $url, array $args ) use ( &$requests ): array {
			$requests[] = array( $url, $args );
			return self::response( 204 );
		} );
		$store = new InstallationStore();
		$connection = self::connectionRecord();
		$store->save( $connection );
		$controller = new StoreContextController( $client, $this->identity(), $store );
		$result = $controller->sync( new \WP_REST_Request( 'POST' ) );
		self::assertSame( 200, $result->get_status() );
		self::assertSame( array( 'status' => 'SYNCED' ), $result->get_data() );
		self::assertSame( 'private, no-store', $result->get_headers()['Cache-Control'] );
		self::assertSame( 'https://api.example.test/v1/merchant/store-context', $requests[0][0] );
		self::assertSame( 'PUT', $requests[0][1]['method'] );
		self::assertSame( 'Bearer ' . $connection['credential'], $requests[0][1]['headers']['Authorization'] );
		self::assertSame( $connection['installationId'], $requests[0][1]['headers']['X-Moda-Installation-Id'] );
		self::assertSame( array(
			'schemaVersion' => 1, 'storeLocale' => 'en_GB', 'languageTag' => 'en-GB',
			'timeZone' => 'Europe/London', 'countryCode' => 'GB',
		), json_decode( $requests[0][1]['body'], true ) );
		self::assertSame( $connection, $store->read()['record'] );
	}

	public function test_rejects_browser_supplied_business_data_without_external_calls(): void {
		$calls = 0;
		$client = $this->client( static function () use ( &$calls ): array {
			$calls++;
			return self::response( 204 );
		} );
		$store = new InstallationStore();
		$store->save( self::connectionRecord() );
		$controller = new StoreContextController( $client, $this->identity(), $store );
		foreach ( array(
			new \WP_REST_Request( 'POST', array( 'shopId' => 'attacker' ) ),
			new \WP_REST_Request( 'POST', array(), array( 'countryCode' => 'US' ) ),
			new \WP_REST_Request( 'POST', array(), null, array( 'siteUrl' => 'attacker' ) ),
		) as $request ) {
			self::assertSame( 400, $controller->sync( $request )->get_status() );
		}
		self::assertSame( 0, $calls );
	}

	public function test_missing_connection_and_site_url_change_cannot_send_context(): void {
		$store = new InstallationStore();
		$controller = new StoreContextController( $this->client( static fn() => self::response( 204 ) ), $this->identity(), $store );
		self::assertSame( 'RECONNECT_REQUIRED', $controller->sync( new \WP_REST_Request( 'POST' ) )->get_data()['status'] );
		$store->save( self::connectionRecord() );
		$GLOBALS['moda_interact_home_url'] = 'http://different-site.local:8080';
		self::assertSame( 'SITE_URL_CHANGED', $controller->sync( new \WP_REST_Request( 'POST' ) )->get_data()['status'] );
	}

	public function test_remote_failure_is_retryable_and_preserves_credentials(): void {
		$store = new InstallationStore();
		$record = self::connectionRecord();
		$store->save( $record );
		$attempt = 0;
		$client = $this->client( static function () use ( &$attempt ): array {
			return self::response( ++$attempt === 1 ? 500 : 204 );
		} );
		$controller = new StoreContextController( $client, $this->identity(), $store );
		self::assertSame( 'REMOTE_UNAVAILABLE', $controller->sync( new \WP_REST_Request( 'POST' ) )->get_data()['status'] );
		self::assertSame( $record, $store->read()['record'] );
		self::assertSame( 'SYNCED', $controller->sync( new \WP_REST_Request( 'POST' ) )->get_data()['status'] );
		self::assertSame( $record, $store->read()['record'] );
	}

	private function controller( int $status ): StoreContextController {
		return new StoreContextController( $this->client( static fn() => self::response( $status ) ), $this->identity() );
	}

	private function client( callable $transport ): ModaApiClient {
		return new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport );
	}

	private function identity(): SiteIdentity {
		return new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) );
	}

	private static function response( int $status ): array {
		return array( 'headers' => array(), 'body' => '', 'response' => array( 'code' => $status ) );
	}

	private static function connectionRecord(): array {
		return array(
			'schemaVersion' => 1,
			'installationId' => 'install_123',
			'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2,
			'connectedAt' => '2026-10-03T12:00:00+00:00',
		);
	}
}
