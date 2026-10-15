<?php

use ModaInteract\WooCommerce\Api\DiscountOffersContracts;
use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\RecoveryDiscountOffersController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class RecoveryDiscountOffersControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_privileged_routes_and_hosted_credentials_without_browser_shop_identity(): void {
		$sent = array();
		$controller = $this->controller( static function ( string $url, array $args ) use ( &$sent ) {
			$sent[] = array( $url, $args );
			return self::response( 200, str_contains( $url, 'discount-catalogue' ) ? self::catalogue() : self::offers() );
		} );
		$controller->registerRoutes();
		self::assertSame( 'GET', $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/discount-catalogue']['methods'] );
		self::assertSame( array( 'GET', 'PUT' ), $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/discount-offers']['methods'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( new WP_REST_Request() )->get_error_data()['status'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( new WP_REST_Request() )->get_error_data()['status'] );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$catalogue = new WP_REST_Request( 'GET', array( 'limit' => '25', 'search' => 'SAVE' ) );
		$catalogue->set_route( '/moda-interact/v1/merchant/discount-catalogue' );
		self::assertSame( 200, $controller->handle( $catalogue )->get_status() );
		$put = new WP_REST_Request( 'PUT', array(), self::update(), array(), array(
			'X-WP-Nonce' => 'fixture_rest_nonce', 'Content-Type' => 'application/json',
		) );
		self::assertSame( 200, $controller->handle( $put )->get_status() );
		self::assertCount( 2, $sent );
		self::assertSame( 'https://api.example.test/v1/merchant/discount-catalogue?limit=25&search=SAVE', $sent[0][0] );
		self::assertSame( self::update(), json_decode( $sent[1][1]['body'], true ) );
		self::assertArrayNotHasKey( 'shopId', json_decode( $sent[1][1]['body'], true ) );
		self::assertSame( 'Bearer ' . self::record()['credential'], $sent[1][1]['headers']['Authorization'] );
		self::assertSame( 0, $sent[1][1]['redirection'] );
	}

	public function test_no_request_can_supply_a_shop_identity_or_revision_or_provider_write(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) { $calls++; return self::response( 200, self::offers() ); } );
		foreach ( array(
			array( 'GET', array( 'shopId' => 'other' ), null ),
			array( 'PUT', array(), array_merge( self::update(), array( 'expectedRevision' => 'forged' ) ) ),
			array( 'PUT', array(), array_merge( self::update(), array( 'providerStatus' => 'ACTIVE' ) ) ),
			array( 'PUT', array(), array( 'recoveryOfferMode' => 'FIXED', 'selectedDiscountIds' => array() ) ),
			array( 'PUT', array(), array( 'recoveryOfferMode' => 'FIXED', 'selectedDiscountIds' => array( 'bad/id' ) ) ),
		) as $case ) {
			$request = new WP_REST_Request( $case[0], $case[1], $case[2], array(), array(
				'X-WP-Nonce' => 'fixture_rest_nonce', 'Content-Type' => 'application/json',
			) );
			self::assertSame( 400, $controller->handle( $request )->get_status() );
		}
		self::assertSame( 0, $calls );
	}

	public function test_sync_unavailable_is_not_misrepresented_as_empty_catalogue(): void {
		$controller = $this->controller( static fn() => self::response( 503, array( 'error' => 'catalogue_not_current' ) ) );
		$request = new WP_REST_Request();
		$request->set_route( '/moda-interact/v1/merchant/discount-catalogue' );
		$reply = $controller->handle( $request );
		self::assertSame( 503, $reply->get_status() );
		self::assertSame( 'CATALOGUE_NOT_CURRENT', $reply->get_data()['status'] );
	}

	public function test_payload_validation_rejects_foreign_identity_fields(): void {
		self::assertFalse( DiscountOffersContracts::offers( array_merge( self::offers(), array( 'shopId' => 'other' ) ) ) );
		self::assertFalse( DiscountOffersContracts::catalogue( array_merge( self::catalogue(), array( 'credential' => 'private' ) ) ) );
		self::assertFalse( DiscountOffersContracts::update( array( 'recoveryOfferMode' => 'FIXED', 'selectedDiscountIds' => array( array( 'bad' ) ) ) ) );
	}

	private function controller( callable $transport ): RecoveryDiscountOffersController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::record() ) );
		return new RecoveryDiscountOffersController(
			new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport ),
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ),
			$store
		);
	}
	private static function update(): array { return array( 'recoveryOfferMode' => 'FIXED', 'selectedDiscountIds' => array( 'coupon_1', 'coupon_2' ) ); }
	private static function offers(): array { return array( 'schemaVersion' => 1, 'revision' => 'r',
		'merchant' => self::update(), 'effective' => array( 'recoveryOfferMode' => 'FIXED' ),
		'source' => 'MERCHANT', 'overrideActive' => false ); }
	private static function catalogue(): array { return array( 'schemaVersion' => 1, 'revision' => 'r',
		'items' => array( array( 'id' => 'coupon_1', 'title' => 'SAVE', 'summary' => null,
			'providerType' => 'WooCoupon:percent', 'code' => 'SAVE', 'startsAt' => null,
			'endsAt' => null, 'selected' => true ) ), 'nextCursor' => null, 'hasMore' => false ); }
	private static function record(): array { return array( 'schemaVersion' => 1,
		'installationId' => 'install_123', 'shopId' => 'shop_456',
		'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
		'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
		'credentialVersion' => 2, 'connectedAt' => '2026-10-03T12:00:00+00:00' ); }
	private static function response( int $status, array $payload ): array { return array(
		'headers' => array( 'content-type' => 'application/json' ),
		'body' => wp_json_encode( $payload ), 'response' => array( 'code' => $status ),
	); }
}
