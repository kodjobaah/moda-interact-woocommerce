<?php

use ModaInteract\WooCommerce\Api\BillingPurchaseHistoryResponseValidator;
use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\BillingController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class BillingPurchaseHistoryTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_option_autoload'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080/store';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
	}

	public function test_get_only_history_proxy_rejects_browser_tenant_and_mutation_fields(): void {
		$requests = array();
		$controller = $this->controller( $requests );
		foreach ( array(
			array( 'shopId' => 'attacker' ),
			array( 'provider' => 'SHOPIFY' ),
			array( 'filter' => 'ACTIVE', 'pageSize' => '25' ),
			array( 'filter' => 'ACTIVE', 'page' => '-1' ),
			array( '_locale' => 'fr_FR' ),
		) as $query ) {
			self::assertSame( 400, $controller->getRecoveryCreditPurchaseHistory( new WP_REST_Request( 'GET', $query ) )->get_status() );
		}
		self::assertSame( array(), $requests );
	}

	public function test_history_is_authenticated_and_forwarded_only_to_hosted_read_endpoint(): void {
		$requests = array();
		$controller = $this->controller( $requests );
		$response = $controller->getRecoveryCreditPurchaseHistory( new WP_REST_Request( 'GET', array(
			'_locale' => 'user', 'filter' => 'ACTIVE', 'page' => '1', 'pageSize' => '5',
		) ) );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( self::history(), $response->get_data() );
		self::assertSame( 'https://api.example.test/v1/billing/recovery-credit-purchases?filter=ACTIVE&page=1&pageSize=5', $requests[0][0] );
		self::assertSame( 'GET', $requests[0][1]['method'] );
		self::assertArrayNotHasKey( 'body', $requests[0][1] );
		self::assertArrayNotHasKey( 'Idempotency-Key', $requests[0][1]['headers'] );
		self::assertArrayNotHasKey( 'shopId', $requests[0][1]['headers'] );
		self::assertSame( 'install_1', $requests[0][1]['headers']['X-Moda-Installation-Id'] );
		self::assertSame( 'private, no-store', $response->get_headers()['Cache-Control'] );
	}

	public function test_strict_response_rejects_injected_provider_ids_and_external_redirects(): void {
		foreach ( array(
			array_merge( self::history(), array( 'providerReference' => 'secret' ) ),
			array_merge( self::history(), array( 'refundRequest' => array( 'method' => 'WOOCOMMERCE_ORDERS', 'url' => 'https://woocommerce.com.attacker.example/orders' ) ) ),
			array_merge( self::history(), array( 'pageSize' => 100 ) ),
		) as $bad ) {
			self::assertFalse( BillingPurchaseHistoryResponseValidator::history( $bad ) );
		}
		self::assertTrue( BillingPurchaseHistoryResponseValidator::history( self::history() ) );
	}

	private function controller( array &$requests ): BillingController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( array(
			'schemaVersion' => 1, 'installationId' => 'install_1', 'shopId' => 'shop_1',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080/store',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 1, 'connectedAt' => gmdate( 'c' ),
		) ) );
		$config = ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' );
		$client = new ModaApiClient( $config, static function ( string $url, array $args ) use ( &$requests ): array {
			$requests[] = array( $url, $args );
			return array( 'headers' => array( 'content-type' => 'application/json' ), 'body' => wp_json_encode( self::history() ), 'response' => array( 'code' => 200 ) );
		} );
		return new BillingController( $config, new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ), $store, $client );
	}

	private static function history(): array {
		return array(
			'schemaVersion' => 1, 'filter' => 'ACTIVE', 'page' => 1, 'pageSize' => 5, 'total' => 0,
			'totalPages' => 1, 'purchases' => array(),
			'refundRequest' => array( 'method' => 'WOOCOMMERCE_ORDERS', 'url' => 'https://woocommerce.com/my-account/orders/' ),
		);
	}
}
