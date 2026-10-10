<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\RecoverySummaryResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\RecoverySummaryController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class RecoverySummaryControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_read_only_route_and_permission(): void {
		$controller = $this->controller( static fn() => self::response( 200, self::policy() ) );
		$controller->registerRoutes();
		$route = $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/recovery-summary'];
		self::assertSame( 'GET', $route['methods'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator()->get_error_data()['status'] );
	}

	public function test_proxy_uses_only_local_installation_identity_and_preserves_connection(): void {
		$sent = array();
		$store = $this->store();
		$controller = new RecoverySummaryController( $this->client( static function ( string $url, array $args ) use ( &$sent ): array {
			$sent = array( $url, $args );
			return self::response( 200, self::policy() );
		} ), $this->identity(), $store );
		$result = $controller->read( new \WP_REST_Request( 'GET', array( '_locale' => 'user' ) ) );
		self::assertSame( 200, $result->get_status() );
		self::assertSame( self::policy(), $result->get_data() );
		self::assertSame( 'https://api.example.test/v1/merchant/recovery-summary', $sent[0] );
		self::assertSame( 'GET', $sent[1]['method'] );
		self::assertSame( 5, $sent[1]['timeout'] );
		self::assertSame( 'Bearer ' . self::record()['credential'], $sent[1]['headers']['Authorization'] );
		self::assertSame( self::record(), $store->read()['record'] );
	}

	public function test_no_browser_shop_id_and_missing_installation(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ): array {
			$calls++;
			return self::response( 200, self::policy() );
		} );
		self::assertSame( 400, $controller->read( new \WP_REST_Request( 'GET', array( 'shopId' => 'foreign' ) ) )->get_status() );
		self::assertSame( 0, $calls );
		// The previous assertion used a connected fixture; explicitly simulate an absent installation.
		delete_option( InstallationStore::OPTION_NAME );
		$store = new InstallationStore();
		self::assertSame( 'missing', $store->read()['state'] );
		$disconnected = new RecoverySummaryController( $this->client( static function () use ( &$calls ): array {
			$calls++;
			return self::response( 200, self::policy() );
		} ), $this->identity(), $store );
		self::assertSame( 401, $disconnected->read( new \WP_REST_Request( 'GET' ) )->get_status() );
		self::assertSame( 0, $calls );
	}

	public function test_invalid_remote_policy_fails_closed(): void {
		$controller = $this->controller( static fn() => self::response( 200, array_merge( self::policy(), array( 'credential' => 'leak' ) ) ) );
		self::assertSame( 'REMOTE_RESPONSE_INVALID', $controller->read( new \WP_REST_Request( 'GET' ) )->get_data()['status'] );
		self::assertFalse( RecoverySummaryResponseValidator::isValid( array_merge( self::policy(), array( 'credential' => 'leak' ) ) ) );
	}

	private function controller( callable $transport ): RecoverySummaryController {
		return new RecoverySummaryController( $this->client( $transport ), $this->identity(), $this->store() );
	}

	private function store(): InstallationStore {
		$store = new InstallationStore();
		$store->save( self::record() );
		return $store;
	}

	private function client( callable $transport ): ModaApiClient {
		return new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport );
	}

	private function identity(): SiteIdentity {
		return new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) );
	}

	private static function record(): array {
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

	private static function policy(): array {
		return array(
			'schemaVersion' => 1,
			'recoveryDelayMinutes' => 30,
			'recoveryOfferMode' => 'NONE',
			'followUpEnabled' => false,
			'followUpDelayMinutes' => null,
			'source' => 'MERCHANT',
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
