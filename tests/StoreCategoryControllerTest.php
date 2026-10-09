<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\StoreCategoryController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class StoreCategoryControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
		$GLOBALS['moda_interact_user_locale'] = 'fr_FR';
		$GLOBALS['moda_interact_store_locale'] = 'en_GB';
	}

	public function test_rest_registration_and_privileged_permissions(): void {
		$controller = $this->controller( static fn() => self::response( 200, self::readPayload() ) );
		$controller->registerRoutes();
		$routes = $GLOBALS['moda_interact_registered_rest_routes'];
		self::assertSame( 'GET', $routes['moda-interact/v1/merchant/store-categories']['methods'] );
		self::assertSame( 'POST', $routes['moda-interact/v1/merchant/store-category']['methods'] );
		self::assertSame( array( $controller, 'authorizeAdministrator' ), $routes['moda-interact/v1/merchant/store-category']['permission_callback'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator()->get_error_data()['status'] );
	}

	public function test_localized_read_uses_administrator_language_and_existing_credential(): void {
		$sent = array();
		$store = $this->store();
		$record = self::record();
		$client = $this->client( static function ( string $url, array $args ) use ( &$sent ): array {
			$sent[] = array( $url, $args );
			return self::response( 200, self::readPayload() );
		} );
		$controller = new StoreCategoryController( $client, $this->identity(), $store );
		$result = $controller->read( new \WP_REST_Request( 'GET', array( '_locale' => 'user' ) ) );
		self::assertSame( 200, $result->get_status() );
		self::assertSame( self::readPayload(), $result->get_data() );
		self::assertSame( 'https://api.example.test/v1/merchant/store-categories?locale=fr_FR', $sent[0][0] );
		self::assertSame( 'GET', $sent[0][1]['method'] );
		self::assertSame( 'Bearer ' . $record['credential'], $sent[0][1]['headers']['Authorization'] );
		self::assertSame( $record, $store->read()['record'] );
	}

	public function test_selection_sends_bounded_cas_and_does_not_rotate_credential(): void {
		$sent = array();
		$store = $this->store();
		$record = self::record();
		$controller = new StoreCategoryController( $this->client( static function ( string $url, array $args ) use ( &$sent ): array {
			$sent[] = array( $url, $args );
			return self::response( 200, self::selectionPayload() );
		} ), $this->identity(), $store );
		$result = $controller->select( new \WP_REST_Request( 'POST', array(), self::selectionInput() ) );
		self::assertSame( 200, $result->get_status() );
		self::assertSame( 'https://api.example.test/v1/merchant/store-category', $sent[0][0] );
		self::assertSame( 'POST', $sent[0][1]['method'] );
		self::assertSame( self::selectionInput(), json_decode( $sent[0][1]['body'], true ) );
		self::assertSame( $record, $store->read()['record'] );
	}

	public function test_rejects_injected_shop_credentials_unknown_fields_and_invalid_generation(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ): array {
			$calls++;
			return self::response( 200, self::selectionPayload() );
		} );
		foreach ( array(
			array_merge( self::selectionInput(), array( 'shopId' => 'victim' ) ),
			array_merge( self::selectionInput(), array( 'credential' => 'secret' ) ),
			array_merge( self::selectionInput(), array( 'expectedPendingSelectionGeneration' => -1 ) ),
			array_merge( self::selectionInput(), array( 'selectedMappingIds' => array( 'map_1', 'map_1' ) ) ),
		) as $payload ) {
			self::assertSame( 400, $controller->select( new \WP_REST_Request( 'POST', array(), $payload ) )->get_status() );
		}
		self::assertSame( 400, $controller->read( new \WP_REST_Request( 'GET', array( 'locale' => 'fr_FR' ) ) )->get_status() );
		self::assertSame( 0, $calls );
	}

	public function test_stale_selection_is_conflict_and_retryable_after_refresh(): void {
		$count = 0;
		$store = $this->store();
		$controller = new StoreCategoryController( $this->client( static function () use ( &$count ): array {
			$count++;
			return 1 === $count ? self::response( 409, array( 'error' => 'store_category_conflict' ) ) : self::response( 200, self::selectionPayload() );
		} ), $this->identity(), $store );
		self::assertSame( 'STORE_CATEGORY_CONFLICT', $controller->select( new \WP_REST_Request( 'POST', array(), self::selectionInput() ) )->get_data()['status'] );
		self::assertSame( 200, $controller->select( new \WP_REST_Request( 'POST', array(), self::selectionInput() ) )->get_status() );
		self::assertSame( self::record(), $store->read()['record'] );
	}

	public function test_site_move_and_missing_installation_are_rejected_without_http(): void {
		$calls = 0;
		$store = new InstallationStore();
		$controller = new StoreCategoryController( $this->client( static function () use ( &$calls ): array {
			$calls++;
			return self::response( 200, self::readPayload() );
		} ), $this->identity(), $store );
		self::assertSame( 'RECONNECT_REQUIRED', $controller->read( new \WP_REST_Request( 'GET' ) )->get_data()['status'] );
		$store->save( self::record() );
		$GLOBALS['moda_interact_home_url'] = 'http://wrong-site.local:8080';
		self::assertSame( 'SITE_URL_CHANGED', $controller->read( new \WP_REST_Request( 'GET' ) )->get_data()['status'] );
		self::assertSame( 0, $calls );
	}

	public function test_invalid_upstream_json_is_not_returned_to_browser(): void {
		$controller = $this->controller( static fn() => self::response( 200, array( 'token' => 'secret' ) ) );
		self::assertSame( 'REMOTE_RESPONSE_INVALID', $controller->read( new \WP_REST_Request( 'GET' ) )->get_data()['status'] );
	}

	private function controller( callable $transport ): StoreCategoryController {
		return new StoreCategoryController( $this->client( $transport ), $this->identity(), $this->store() );
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

	private static function response( int $status, array $payload ): array {
		return array( 'headers' => array( 'content-type' => 'application/json' ), 'body' => json_encode( $payload ), 'response' => array( 'code' => $status ) );
	}

	private static function selectionInput(): array {
		return array( 'schemaVersion' => 1, 'categoryId' => 'cat_1', 'selectedMappingIds' => array( 'map_1' ), 'expectedPendingSelectionGeneration' => 0 );
	}

	private static function selectionPayload(): array {
		return array( 'schemaVersion' => 1, 'activeCategoryId' => 'cat_1', 'activePromptRevisionId' => 'prompt_1', 'activeMappingIds' => array( 'map_1' ), 'pendingSelectionGeneration' => 1 );
	}

	private static function readPayload(): array {
		$category = array( 'id' => 'cat_1', 'slug' => 'fashion', 'localizedDisplayName' => 'Mode', 'localizedDescription' => 'Une boutique de vêtements' );
		return array(
			'schemaVersion' => 1, 'requestedLocale' => 'fr_FR', 'resolvedLocale' => 'fr',
			'categories' => array( array_merge( $category, array(
				'mappings' => array( array( 'id' => 'map_1', 'conditionKey' => 'is_fashion', 'localizedDisplayName' => 'Fashion' ) ),
				'defaultTemplate' => array( 'id' => 'tpl_1', 'key' => 'retail', 'displayName' => 'Retail', 'editVersion' => 1 ),
			) ) ),
			'storeProfile' => array(
				'activeCategory' => null, 'pendingCategory' => null, 'activeMappingIds' => array(),
				'pendingMappingIds' => array(), 'pendingSelectionGeneration' => 0,
				'pendingSelectedAt' => null, 'pendingState' => 'NONE', 'pendingTemplate' => null,
			),
		);
	}
}
