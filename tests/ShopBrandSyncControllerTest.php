<?php

use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\ShopBrandSyncController;
use ModaInteract\WooCommerce\Security\Base64Url;
use ModaInteract\WooCommerce\ShopBrand\Publisher;
use ModaInteract\WooCommerce\ShopBrand\SyncStatusStore;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/Rest/ShopBrandSyncController.php';
require_once dirname( __DIR__ ) . '/includes/ShopBrand/Publisher.php';

if ( ! function_exists( 'as_enqueue_async_action' ) ) {
	function as_enqueue_async_action( $hook, $args, $group, $unique ) {
		$GLOBALS['arch049_sync_queued'][] = compact( 'hook', 'args', 'group', 'unique' );
		return count( $GLOBALS['arch049_sync_queued'] );
	}
}

final class ShopBrandSyncControllerTest extends TestCase {
	private array $record;
	private InstallationStore $installations;
	private SiteIdentity $identity;

	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_option_autoload'] = array();
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['arch049_scheduler_ready'] = true;
		$GLOBALS['arch049_sync_queued'] = array();
		$GLOBALS['arch035_queued'] = array();
		$this->record = array(
			'schemaVersion' => 1,
			'installationId' => 'woo-install-1',
			'shopId' => 'shop-1',
			'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( "\x05", 32 ) ),
			'credentialVersion' => 1,
			'connectedAt' => '2026-10-27T09:00:00Z',
		);
		$this->installations = new InstallationStore();
		self::assertTrue( $this->installations->save( $this->record ) );
		$this->identity = new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '93.184.216.34' ) );
	}

	public function test_routes_require_manage_woocommerce_and_rest_nonce(): void {
		$controller = $this->controller();
		$controller->registerRoutes();
		$route = $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/shop-brand/sync'];
		self::assertSame( array( 'GET', 'POST' ), array_column( $route, 'methods' ) );
		$request = new WP_REST_Request( 'GET' );
		self::assertTrue( $controller->authorize( $request ) );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorize( $request )->get_error_data()['status'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$request->set_header( 'X-WP-Nonce', 'bad' );
		self::assertSame( 403, $controller->authorize( $request )->get_error_data()['status'] );
	}

	public function test_get_returns_exact_private_installation_scoped_projection(): void {
		$controller = $this->controller();
		$result = $controller->read( new WP_REST_Request( 'GET', array( '_locale' => 'user' ) ) );
		self::assertSame( 200, $result->get_status() );
		self::assertSame( array( 'status' => 'NEVER_SYNCED', 'lastRequestedAt' => null, 'lastAcceptedAt' => null ), $result->get_data() );
		self::assertSame( 'private, no-store', $result->get_headers()['Cache-Control'] );
		self::assertArrayNotHasKey( 'shopId', $result->get_data() );
	}

	public function test_post_enqueues_existing_capture_and_returns_202_without_identifiers(): void {
		$controller = $this->controller();
		$result = $controller->requestSync( new WP_REST_Request( 'POST' ) );
		self::assertSame( 202, $result->get_status() );
		self::assertSame( array( 'status' => 'QUEUED' ), $result->get_data() );
		$queued = array_merge( $GLOBALS['arch049_sync_queued'] ?? array(), $GLOBALS['arch035_queued'] ?? array() );
		self::assertCount( 1, $queued );
		self::assertSame( Publisher::CAPTURE_ACTION, $queued[0]['hook'] );
		self::assertCount( 3, $queued[0]['args'] );
		self::assertSame( 'QUEUED', $controller->read( new WP_REST_Request( 'GET' ) )->get_data()['status'] );
		self::assertFalse( $GLOBALS['moda_interact_option_autoload'][SyncStatusStore::OPTION_NAME] );
	}

	public function test_rejects_foreign_input_disconnected_state_and_changed_site_identity(): void {
		$controller = $this->controller();
		foreach ( array( new WP_REST_Request( 'POST', array( 'shopId' => 'foreign' ) ), new WP_REST_Request( 'POST', array(), array( 'installationId' => 'foreign' ) ) ) as $request ) {
			self::assertSame( 400, $controller->requestSync( $request )->get_status() );
		}
		self::assertCount( 0, $GLOBALS['arch049_sync_queued'] );
		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 'RECONNECT_REQUIRED', $controller->read( new WP_REST_Request( 'GET' ) )->get_data()['status'] );
		self::assertTrue( $this->installations->save( $this->record ) );
		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = array( 'invalid' => true );
		self::assertSame( 'LOCAL_STATE_INVALID', $controller->read( new WP_REST_Request( 'GET' ) )->get_data()['status'] );
		self::assertTrue( $this->installations->save( $this->record ) );
		$GLOBALS['moda_interact_home_url'] = 'https://changed.example';
		self::assertSame( 'SITE_URL_CHANGED', $controller->read( new WP_REST_Request( 'GET' ) )->get_data()['status'] );
	}

	private function controller(): ShopBrandSyncController {
		return new ShopBrandSyncController( new Publisher( null, $this->installations, $this->identity ), $this->identity, $this->installations );
	}
}
