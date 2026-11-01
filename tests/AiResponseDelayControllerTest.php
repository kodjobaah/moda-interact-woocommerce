<?php

use ModaInteract\WooCommerce\Api\AiResponseDelayResponseValidator;
use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\AiResponseDelayController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class AiResponseDelayControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	protected function tearDown(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_route_requires_woocommerce_capability_and_rest_nonce_and_uses_private_no_store(): void {
		$sent = array();
		$controller = $this->controller( static function ( string $url, array $args ) use ( &$sent ) {
			$sent[] = array( $url, $args );
			return self::response( 200, self::read() );
		} );
		$controller->registerRoutes();
		$route = $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/ai-response-delay'];
		self::assertSame( array( 'GET', 'PUT' ), $route['methods'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( new WP_REST_Request() )->get_error_data()['status'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( new WP_REST_Request() )->get_error_data()['status'] );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		self::assertTrue( $controller->authorizeAdministrator( new WP_REST_Request() ) );

		$response = $controller->handle( new WP_REST_Request( 'GET' ) );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( self::read(), $response->get_data() );
		self::assertSame( 'private, no-store', $response->get_headers()['Cache-Control'] );
		self::assertSame( 'no-cache', $response->get_headers()['Pragma'] );
		self::assertSame( 'https://api.example.test/v1/merchant/ai-response-delay', $sent[0][0] );
		self::assertSame( 'GET', $sent[0][1]['method'] );
		self::assertSame( 'Bearer ' . self::record()['credential'], $sent[0][1]['headers']['Authorization'] );
	}

	public function test_put_forwards_only_the_exact_v1_wire_and_accepts_both_boundaries(): void {
		$sent = array();
		$controller = $this->controller( static function ( string $url, array $args ) use ( &$sent ) {
			$sent[] = array( $url, $args );
			return self::response( 200, self::read( json_decode( $args['body'], true )['aiResponseDelayMinutes'] ) );
		} );
		foreach ( range( 0, 30 ) as $minutes ) {
			$request = self::put( array(
				'schemaVersion' => 1,
				'expectedRevision' => 'UNCONFIGURED',
				'aiResponseDelayMinutes' => $minutes,
			) );
			$response = $controller->handle( $request );
			self::assertSame( 200, $response->get_status() );
			self::assertSame( $minutes, $response->get_data()['aiResponseDelayMinutes'] );
		}
		self::assertSame( 'PUT', $sent[0][1]['method'] );
		self::assertSame( 'application/json', $sent[0][1]['headers']['Content-Type'] );
		self::assertSame( array( 'schemaVersion', 'expectedRevision', 'aiResponseDelayMinutes' ), array_keys( json_decode( $sent[0][1]['body'], true ) ) );
		self::assertArrayNotHasKey( 'shopId', json_decode( $sent[0][1]['body'], true ) );
	}

	public function test_rejects_invalid_values_unknown_keys_and_browser_identity_before_network(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) {
			$calls++;
			return self::response( 200, self::read() );
		} );
		$valid = array( 'schemaVersion' => 1, 'expectedRevision' => 'UNCONFIGURED', 'aiResponseDelayMinutes' => 7 );
		$invalid = array(
			array_merge( $valid, array( 'aiResponseDelayMinutes' => -1 ) ),
			array_merge( $valid, array( 'aiResponseDelayMinutes' => 31 ) ),
			array_merge( $valid, array( 'aiResponseDelayMinutes' => 0.5 ) ),
			array_merge( $valid, array( 'aiResponseDelayMinutes' => '7' ) ),
			array_merge( $valid, array( 'aiResponseDelayMinutes' => null ) ),
			array_merge( $valid, array( 'shopId' => 'foreign-shop' ) ),
			array_merge( $valid, array( 'credential' => 'secret' ) ),
			array_merge( $valid, array( 'expectedRevision' => 'bad' ) ),
			array_merge( $valid, array( 'schemaVersion' => 2 ) ),
		);
		foreach ( $invalid as $body ) self::assertSame( 400, $controller->handle( self::put( $body ) )->get_status() );
		self::assertSame( 400, $controller->handle( new WP_REST_Request( 'GET', array( 'shopId' => 'foreign-shop' ) ) )->get_status() );
		self::assertSame( 0, $calls );
		self::assertFalse( AiResponseDelayResponseValidator::isValid( array_merge( self::read(), array( 'extra' => true ) ) ) );
		self::assertFalse( AiResponseDelayResponseValidator::isValid( array_merge( self::read(), array( 'aiResponseDelayMinutes' => '7' ) ) ) );
	}

	public function test_site_identity_and_installation_rotation_are_rechecked_after_the_api_response(): void {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::record() ) );
		$controller = $this->controller( static function () use ( $store ) {
			$rotated = self::record();
			$rotated['credentialVersion'] = 3;
			$store->save( $rotated );
			return self::response( 200, self::read() );
		}, $store );
		self::assertSame( array( 'status' => 'RECONNECT_REQUIRED' ), $controller->handle( new WP_REST_Request( 'GET' ) )->get_data() );

		$GLOBALS['moda_interact_home_url'] = 'https://changed.example';
		$calls = 0;
		$changed = $this->controller( static function () use ( &$calls ) {
			$calls++;
			return self::response( 200, self::read() );
		} );
		self::assertSame( array( 'status' => 'SITE_URL_CHANGED' ), $changed->handle( new WP_REST_Request( 'GET' ) )->get_data() );
		self::assertSame( 0, $calls );
	}

	public function test_conflict_and_server_failure_are_sanitized(): void {
		$conflict = $this->controller( static fn() => self::response( 409, array( 'error' => 'ai_response_delay_conflict' ) ) );
		self::assertSame( array( 'status' => 'AI_RESPONSE_DELAY_CONFLICT' ), $conflict->handle( self::put( self::update() ) )->get_data() );
		$failure = $this->controller( static fn() => self::response( 500, array( 'error' => 'internal_error' ) ) );
		self::assertSame( 503, $failure->handle( new WP_REST_Request( 'GET' ) )->get_status() );
		self::assertSame( array( 'status' => 'REMOTE_UNAVAILABLE' ), $failure->handle( new WP_REST_Request( 'GET' ) )->get_data() );
	}

	private function controller( callable $transport, ?InstallationStore $store = null ): AiResponseDelayController {
		$store = $store ?? new InstallationStore();
		if ( 'valid' !== $store->read()['state'] ) self::assertTrue( $store->save( self::record() ) );
		return new AiResponseDelayController(
			new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport ),
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ),
			$store
		);
	}

	private static function put( array $body ): WP_REST_Request {
		return new WP_REST_Request( 'PUT', array(), $body, array(), array(
			'X-WP-Nonce' => 'fixture_rest_nonce', 'Content-Type' => 'application/json',
		) );
	}

	private static function update(): array {
		return array( 'schemaVersion' => 1, 'expectedRevision' => 'UNCONFIGURED', 'aiResponseDelayMinutes' => 7 );
	}

	private static function read( int $minutes = 7 ): array {
		return array( 'schemaVersion' => 1, 'revision' => '2026-10-31T16:28:55.123Z', 'aiResponseDelayMinutes' => $minutes );
	}

	private static function record(): array {
		return array(
			'schemaVersion' => 1, 'installationId' => 'install_123', 'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2, 'connectedAt' => '2026-10-03T12:00:00+00:00',
		);
	}

	private static function response( int $status, array $payload ): array {
		return array(
			'headers' => array( 'content-type' => 'application/json' ),
			'body' => wp_json_encode( $payload ),
			'response' => array( 'code' => $status ),
		);
	}
}
