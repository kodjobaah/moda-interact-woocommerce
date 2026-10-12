<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\RecoveryDetailResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\RecoveryDetailController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class RecoveryDetailControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	private static function installed(): array {
		return array(
			'schemaVersion' => 1, 'installationId' => 'install_1', 'shopId' => 'shop_1',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2, 'connectedAt' => '2026-10-03T12:00:00+00:00',
		);
	}

	private static function summary(): array {
		return array(
			'schemaVersion' => 1, 'id' => 'rec_1', 'status' => 'COMPLETED', 'timeZone' => 'Europe/London',
			'value' => array( 'amount' => '89.99', 'currency' => 'GBP', 'incomplete' => false ),
			'customer' => array( 'firstName' => 'Ada', 'lastName' => 'Lovelace', 'email' => 'ada@example.invalid' ),
			'hasConversation' => true,
			'milestones' => array(
				'detectedAt' => '2026-10-09T12:00:00.000Z', 'messageSentAt' => '2026-10-09T13:00:00.000Z',
				'engagedAt' => null, 'completedAt' => '2026-10-09T14:00:00.000Z', 'expiredAt' => null,
			),
		);
	}

	private static function messages(): array {
		return array( 'schemaVersion' => 1, 'previousCursor' => null, 'nextCursor' => 'abc_123', 'items' => array(
			array( 'id' => 'msg_1', 'createdAt' => '2026-10-09T13:00:00.000Z', 'direction' => 'OUTBOUND',
				'sender' => 'AGENT', 'content' => array( 'type' => 'TEXT', 'text' => 'Welcome', 'transcriptionStatus' => null ),
				'delivery' => array( 'status' => 'DELIVERED', 'sentAt' => '2026-10-09T13:00:00.000Z',
					'deliveredAt' => '2026-10-09T13:00:01.000Z', 'readAt' => null ) ),
		) );
	}

	private function request( string $id = 'rec_1', array $query = array() ): WP_REST_Request {
		$request = new WP_REST_Request( 'GET', $query );
		$request->set_url_params( array( 'recoveryId' => $id ) );
		return $request;
	}

	private function makeController( array &$requests, array $payload, int $status = 200 ): RecoveryDetailController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::installed() ) );
		$api = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function ( string $url, array $options ) use ( &$requests, $payload, $status ): array {
				$requests[] = array( $url, $options );
				return array( 'headers' => array( 'content-type' => 'application/json' ),
					'body' => wp_json_encode( $payload ), 'response' => array( 'code' => $status ) );
			} );
		return new RecoveryDetailController( $api,
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ), $store );
	}

	public function test_all_three_read_routes_are_capability_protected_and_use_installation_identity(): void {
		$requests = array();
		$controller = $this->makeController( $requests, self::summary() );
		$controller->registerRoutes();
		self::assertCount( 3, $GLOBALS['moda_interact_registered_rest_routes'] );
		foreach ( $GLOBALS['moda_interact_registered_rest_routes'] as $route ) {
			self::assertSame( 'GET', $route['methods'] );
		}
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator()->get_error_data()['status'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$response = $controller->read( $this->request() );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( self::summary(), $response->get_data() );
		self::assertSame( 'private, no-store', $response->get_headers()['Cache-Control'] );
		self::assertCount( 1, $requests );
		self::assertSame( '/v1/merchant/recoveries/rec_1', parse_url( $requests[0][0], PHP_URL_PATH ) );
		self::assertSame( 'Bearer ' . self::installed()['credential'], $requests[0][1]['headers']['Authorization'] );
		self::assertArrayNotHasKey( 'body', $requests[0][1] );
	}

	public function test_cursor_pages_are_forwarded_without_unrelated_or_tenant_fields(): void {
		$requests = array();
		$controller = $this->makeController( $requests, self::messages() );
		$response = $controller->read( $this->request( 'rec_1', array( 'cursor' => 'abc_123' ) ), 'messages' );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( self::messages(), $response->get_data() );
		self::assertSame( '/v1/merchant/recoveries/rec_1/messages', parse_url( $requests[0][0], PHP_URL_PATH ) );
		self::assertSame( 'cursor=abc_123', parse_url( $requests[0][0], PHP_URL_QUERY ) );
		self::assertFalse( str_contains( $requests[0][0], 'shopId' ) );
	}

	public function test_bad_inputs_fail_before_outbound_http_and_not_found_is_safe(): void {
		$requests = array();
		$controller = $this->makeController( $requests, self::summary() );
		foreach ( array( $this->request( '../1' ), $this->request( 'rec_1', array( 'shopId' => 'foreign' ) ),
			$this->request( 'rec_1', array( 'cursor' => array( 'x', 'y' ) ) ),
			$this->request( 'rec_1', array( 'cursor' => 'abc', 'window' => 'latest' ) ) ) as $request ) {
			self::assertSame( 400, $controller->read( $request )->get_status() );
		}
		self::assertSame( array(), $requests );
		$missing = $this->makeController( $requests, array( 'error' => 'not_found' ), 404 );
		self::assertSame( 404, $missing->read( $this->request() )->get_status() );
	}

	public function test_strict_response_redaction_rejects_hidden_credentials_and_bad_cursor_pages(): void {
		self::assertTrue( RecoveryDetailResponseValidator::isSummary( self::summary() ) );
		self::assertTrue( RecoveryDetailResponseValidator::isPage( self::messages(), 'messages' ) );
		self::assertFalse( RecoveryDetailResponseValidator::isSummary( array_merge( self::summary(), array( 'token' => 'secret' ) ) ) );
		$bad = self::messages();
		$bad['items'][0]['content']['rawMedia'] = 'private';
		self::assertFalse( RecoveryDetailResponseValidator::isPage( $bad, 'messages' ) );
		$requests = array();
		$controller = $this->makeController( $requests, array_merge( self::summary(), array( 'token' => 'secret' ) ) );
		self::assertSame( 502, $controller->read( $this->request() )->get_status() );
		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 401, $controller->read( $this->request() )->get_status() );
		self::assertCount( 1, $requests );
	}
}
