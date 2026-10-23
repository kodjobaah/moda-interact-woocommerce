<?php

require_once dirname( __DIR__ ) . '/includes/Api/PromotionsResponseValidator.php';
require_once dirname( __DIR__ ) . '/includes/Rest/PromotionsController.php';

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\PromotionsResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\PromotionsController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class PromotionsControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_user_locale'] = 'fr_FR';
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_privileged_get_forwards_exact_pages_and_server_admin_locale(): void {
		$sent = array();
		$controller = $this->controller( $sent );
		$controller->registerRoutes();
		$routes = $GLOBALS['moda_interact_registered_rest_routes'];
		self::assertSame( 'GET', $routes['moda-interact/v1/merchant/promotions']['methods'] );
		self::assertSame( 'PUT', $routes['moda-interact/v1/merchant/promotions/selection']['methods'] );
		$request = new WP_REST_Request( 'GET', array( '_locale' => 'user', 'offerPage' => '2', 'historyPage' => '1' ) );
		$response = $controller->read( $request );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( self::readResponse(), $response->get_data() );
		self::assertSame( 'private, no-store', $response->get_headers()['Cache-Control'] );
		self::assertCount( 1, $sent );
		self::assertSame( '/v1/merchant/promotions', parse_url( $sent[0][0], PHP_URL_PATH ) );
		parse_str( (string) parse_url( $sent[0][0], PHP_URL_QUERY ), $query );
		self::assertSame( array( 'offerPage' => '2', 'historyPage' => '1', 'locale' => 'fr-FR' ), $query );
		self::assertSame( 'Bearer ' . self::record()['credential'], $sent[0][1]['headers']['Authorization'] );
		self::assertSame( 'install_1', $sent[0][1]['headers']['X-Moda-Installation-Id'] );
		self::assertArrayNotHasKey( 'body', $sent[0][1] );
		self::assertSame( 0, $sent[0][1]['redirection'] );
		self::assertArrayNotHasKey( 'shopId', $query );
	}

	public function test_rejects_permission_nonce_unexpected_fields_and_invalid_pages_without_network(): void {
		$sent = array();
		$controller = $this->controller( $sent );
		$request = new WP_REST_Request( 'GET' );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( $request )->get_error_data()['status'] );
		self::assertSame( 403, $controller->read( $request )->get_status() );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->read( $request )->get_status() );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		foreach ( array( array( 'shopId' => 'shop_other' ), array( 'locale' => 'de-DE' ),
			array( 'offerPage' => '0' ), array( 'historyPage' => '1001' ),
			array( 'offerPage' => array( '1', '2' ) ), array( '_locale' => 'site' ) ) as $query ) {
			self::assertSame( 400, $controller->read( new WP_REST_Request( 'GET', $query ) )->get_status() );
		}
		self::assertSame( array(), $sent );
	}

	public function test_put_forwards_only_compare_and_set_json_and_maps_conflict(): void {
		$sent = array();
		$body = array( 'campaignId' => 'promo_1', 'expectedRevision' => str_repeat( 'a', 64 ) );
		$controller = $this->controller( $sent, self::selectResponse() );
		$put = new WP_REST_Request( 'PUT', array(), $body, array(), array(
			'X-WP-Nonce' => 'fixture_rest_nonce', 'Content-Type' => 'application/json',
		) );
		self::assertSame( 200, $controller->select( $put )->get_status() );
		self::assertCount( 1, $sent );
		self::assertSame( '/v1/merchant/promotions/selection', parse_url( $sent[0][0], PHP_URL_PATH ) );
		self::assertSame( 'PUT', $sent[0][1]['method'] );
		self::assertSame( 'application/json', $sent[0][1]['headers']['Content-Type'] );
		self::assertSame( $body, json_decode( $sent[0][1]['body'], true ) );
		self::assertArrayNotHasKey( 'shopId', $sent[0][1]['headers'] );

		$controller = $this->controller( $sent, array( 'error' => 'promotion_revision_conflict' ), 409 );
		$response = $controller->select( $put );
		self::assertSame( 409, $response->get_status() );
		self::assertSame( array( 'status' => 'PROMOTION_STALE' ), $response->get_data() );
		self::assertSame( 'private, no-store', $response->get_headers()['Cache-Control'] );
	}

	public function test_put_rejects_invalid_json_extra_keys_and_missing_content_type(): void {
		$sent = array();
		$controller = $this->controller( $sent );
		$valid = array( 'campaignId' => 'promo_1', 'expectedRevision' => str_repeat( 'a', 64 ) );
		foreach ( array( array_merge( $valid, array( 'shopId' => 'other' ) ),
			array_merge( $valid, array( 'expectedRevision' => 'replay' ) ),
			array( 'campaignId' => 'bad/id', 'expectedRevision' => $valid['expectedRevision'] ),
		) as $body ) self::assertSame( 400, $controller->select( self::put( $body ) )->get_status() );
		self::assertSame( 400, $controller->select( new WP_REST_Request( 'PUT', array(), $valid ) )->get_status() );
		self::assertSame( 400, $controller->select( self::put( $valid, array( 'shop' => 'x' ) ) )->get_status() );
		self::assertSame( array(), $sent );
	}

	public function test_no_data_leaks_after_disconnect_credential_rotation_or_site_identity_change(): void {
		$sent = array();
		$controller = $this->controller( $sent, self::readResponse(), 200, static function () {
			$store = new InstallationStore();
			$record = self::record();
			$record['credentialVersion'] = 3;
			$store->save( $record );
		} );
		$response = $controller->read( new WP_REST_Request() );
		self::assertSame( 409, $response->get_status() );
		self::assertSame( array( 'status' => 'RECONNECT_REQUIRED' ), $response->get_data() );
		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 401, $controller->read( new WP_REST_Request() )->get_status() );
		self::assertCount( 1, $sent );
		$store = new InstallationStore();
		$store->save( self::record() );
		$GLOBALS['moda_interact_home_url'] = 'http://changed-sandbox.local:8080';
		self::assertSame( 409, $controller->read( new WP_REST_Request() )->get_status() );
		self::assertCount( 1, $sent );
	}

	public function test_dto_rejects_foreign_fields_invalid_history_and_inconsistent_balances(): void {
		self::assertTrue( PromotionsResponseValidator::read( self::readResponse() ) );
		self::assertTrue( PromotionsResponseValidator::selected( self::selectResponse() ) );
		$foreign = array_merge( self::readResponse(), array( 'shopId' => 'other' ) );
		self::assertFalse( PromotionsResponseValidator::read( $foreign ) );
		$history = self::readResponse();
		$history['history']['entries'][0]['status'] = 'ACTIVE';
		self::assertFalse( PromotionsResponseValidator::read( $history ) );
		$grant = self::readResponse();
		$grant['selection']['remainingQuantity'] = 999;
		self::assertFalse( PromotionsResponseValidator::read( $grant ) );
		$offer = self::readResponse();
		$offer['offers'][0]['selectable'] = 'true';
		self::assertFalse( PromotionsResponseValidator::read( $offer ) );
		$sent = array();
		self::assertSame( 502, $this->controller( $sent, $foreign )->read( new WP_REST_Request() )->get_status() );
	}

	private function controller( array &$sent, ?array $payload = null, int $status = 200, ?callable $after = null ): PromotionsController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::record() ) );
		$api = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function ( string $url, array $args ) use ( &$sent, $payload, $status, $after ): array {
				$sent[] = array( $url, $args );
				if ( $after ) $after();
				return array( 'headers' => array( 'content-type' => 'application/json' ),
					'body' => wp_json_encode( $payload ?? self::readResponse() ),
					'response' => array( 'code' => $status ) );
			} );
		return new PromotionsController( $api,
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ), $store );
	}

	private static function put( array $body, array $query = array() ): WP_REST_Request {
		return new WP_REST_Request( 'PUT', $query, $body, array(), array(
			'X-WP-Nonce' => 'fixture_rest_nonce', 'Content-Type' => 'application/json',
		) );
	}

	private static function record(): array {
		return array( 'schemaVersion' => 1, 'installationId' => 'install_1', 'shopId' => 'shop_1',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2, 'connectedAt' => '2026-10-03T12:00:00+00:00' );
	}

	private static function selection(): array {
		return array( 'campaignId' => 'promo_1', 'merchantTitle' => 'Autumn', 'remainingQuantity' => 3,
			'quantityGranted' => 5, 'reservedQuantity' => 1, 'committedQuantity' => 1,
			'expiresAt' => '2026-11-01T00:00:00.000Z', 'locked' => true, 'exhausted' => false,
			'campaignStatus' => 'ACTIVE', 'targetEligible' => true, 'spendable' => true );
	}

	private static function selectResponse(): array {
		return array( 'schemaVersion' => 1, 'revision' => str_repeat( 'b', 64 ), 'selection' => self::selection() );
	}

	private static function readResponse(): array {
		return array( 'schemaVersion' => 1, 'revision' => str_repeat( 'a', 64 ),
			'offers' => array( array( 'id' => 'promo_1', 'merchantTitle' => 'Autumn', 'merchantDescription' => 'Credit offer',
				'quantity' => 5, 'expiresAt' => '2026-11-01T00:00:00.000Z', 'remainingQuantity' => 3,
				'exhausted' => false, 'previouslyClaimed' => true, 'currentlySelected' => true,
				'eligible' => true, 'selectable' => false ) ),
			'offersPagination' => array( 'page' => 1, 'pageSize' => 6, 'totalEntries' => 1, 'totalPages' => 1 ),
			'selection' => self::selection(),
			'history' => array( 'entries' => array( array( 'campaignId' => 'promo_1', 'campaignTitle' => 'Autumn',
				'status' => 'USED', 'quantityGranted' => 5, 'committedQuantity' => 1, 'remainingQuantity' => 3,
				'lastSelectedAt' => '2026-10-20T00:00:00.000Z', 'expiresAt' => '2026-11-01T00:00:00.000Z' ) ),
				'page' => 1, 'pageSize' => 6, 'totalEntries' => 1, 'totalPages' => 1 ) );
	}
}
