<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\RecoveryListResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\RecoveryListController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class RecoveryListControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_get_only_privileged_proxy_and_no_cache(): void {
		$requests = array();
		$controller = $this->controller( $requests );
		$controller->registerRoutes();
		$route = $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/recoveries'];
		self::assertSame( 'GET', $route['methods'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator()->get_error_data()['status'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$response = $controller->read( new WP_REST_Request( 'GET', array(
			'_locale' => 'user', 'page' => '2', 'pageSize' => '10', 'status' => 'COMPLETED',
			'q' => 'Ada Lovelace', 'from' => '2026-10-01', 'to' => '2026-10-11',
		) ) );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( self::listing(), $response->get_data() );
		self::assertSame( 'private, no-store', $response->get_headers()['Cache-Control'] );
		self::assertCount( 1, $requests );
		self::assertSame( 'GET', $requests[0][1]['method'] );
		self::assertSame( 'Bearer ' . self::installation()['credential'], $requests[0][1]['headers']['Authorization'] );
		self::assertSame( 'install_1', $requests[0][1]['headers']['X-Moda-Installation-Id'] );
		self::assertArrayNotHasKey( 'body', $requests[0][1] );
		self::assertSame( 0, $requests[0][1]['redirection'] );
		$path = parse_url( $requests[0][0], PHP_URL_PATH );
		self::assertSame( '/v1/merchant/recoveries', $path );
		$query = array();
		parse_str( (string) parse_url( $requests[0][0], PHP_URL_QUERY ), $query );
		self::assertSame( array(
			'page' => '2', 'pageSize' => '10', 'status' => 'COMPLETED',
			'q' => 'Ada Lovelace', 'from' => '2026-10-01', 'to' => '2026-10-11',
		), $query );
		self::assertArrayNotHasKey( 'shopId', $query );
	}

	public function test_rejects_foreign_identity_invalid_pagination_and_unexpected_fields_without_network(): void {
		$requests = array();
		$controller = $this->controller( $requests );
		foreach ( array(
			array( 'shopId' => 'other-shop' ), array( 'provider' => 'SHOPIFY' ),
			array( 'page' => '0' ), array( 'page' => '10000' ), array( 'pageSize' => '1000' ),
			array( 'page' => array( '1', '2' ) ), array( 'status' => 'UNRECOGNIZED' ),
			array( 'from' => '2026-02-30' ), array( '_locale' => 'fr_FR' ),
			array( 'q' => "hi\x01" ),
		) as $query ) {
			self::assertSame( 400, $controller->read( new WP_REST_Request( 'GET', $query ) )->get_status() );
		}
		self::assertSame( array(), $requests );
	}

	public function test_rejects_foreign_fields_invalid_pages_and_sensitive_payload(): void {
		self::assertTrue( RecoveryListResponseValidator::isValid( self::listing() ) );
		foreach ( array(
			array_merge( self::listing(), array( 'shopId' => 'another-shop' ) ),
			array_merge( self::listing(), array( 'pageSize' => 50 ) ),
			array_merge( self::listing(), array( 'hasNext' => true ) ),
			array_merge( self::listing(), array( 'totalPages' => 3 ) ),
			array_merge( self::listing(), array( 'items' => array(
				array_merge( self::listing()['items'][0], array( 'checkoutToken' => 'secret' ) ),
			) ) ),
		) as $invalid ) self::assertFalse( RecoveryListResponseValidator::isValid( $invalid ) );
	}

	public function test_rejects_invalid_hosted_response_and_changed_local_identity(): void {
		$requests = array();
		$controller = $this->controller( $requests, array_merge( self::listing(), array( 'credential' => 'leak' ) ) );
		$response = $controller->read( new WP_REST_Request( 'GET' ) );
		self::assertSame( 502, $response->get_status() );
		self::assertSame( array( 'status' => 'REMOTE_RESPONSE_INVALID' ), $response->get_data() );
		self::assertCount( 1, $requests );

		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 401, $controller->read( new WP_REST_Request( 'GET' ) )->get_status() );
		self::assertCount( 1, $requests );
	}

	private function controller( array &$requests, ?array $payload = null ): RecoveryListController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::installation() ) );
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function ( string $url, array $args ) use ( &$requests, $payload ): array {
				$requests[] = array( $url, $args );
				return array( 'headers' => array( 'content-type' => 'application/json' ),
					'body' => wp_json_encode( $payload ?? self::listing() ), 'response' => array( 'code' => 200 ) );
			} );
		return new RecoveryListController( $client,
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ), $store );
	}

	private static function installation(): array {
		return array(
			'schemaVersion' => 1, 'installationId' => 'install_1', 'shopId' => 'shop_1',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2, 'connectedAt' => '2026-10-03T12:00:00+00:00',
		);
	}

	private static function listing(): array {
		return array(
			'schemaVersion' => 1, 'timeZone' => 'Europe/London',
			'from' => '2026-10-01', 'to' => '2026-10-11', 'q' => 'Ada Lovelace',
			'status' => 'COMPLETED', 'page' => 2, 'pageSize' => 10, 'total' => 12,
			'totalPages' => 2, 'hasPrevious' => true, 'hasNext' => false,
			'items' => array( array(
				'id' => 'recovery_1', 'status' => 'COMPLETED',
				'detectedAt' => '2026-10-10T12:00:00.000Z', 'lastActivityAt' => '2026-10-10T12:30:00.000Z',
				'totalPrice' => '123.45', 'currency' => 'GBP',
				'customer' => array( 'displayName' => 'Ada Lovelace', 'email' => 'ada@example.invalid' ),
			) ),
		);
	}
}
