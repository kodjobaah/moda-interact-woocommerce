<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\SupportResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\SupportController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

// The production Composer classmap is bundled; Runtime loads these classes explicitly.
require_once dirname( __DIR__ ) . '/includes/Api/SupportResponseValidator.php';
require_once dirname( __DIR__ ) . '/includes/Rest/SupportController.php';

final class SupportControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_routes_require_both_capability_and_nonce(): void {
		$controller = $this->controller( static fn() => self::response( 200, self::page() ) );
		$controller->registerRoutes();
		self::assertCount( 2, $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/support/messages'] );
		self::assertArrayHasKey( 'moda-interact/v1/merchant/support/messages/(?P<messageId>[A-Za-z0-9_-]{1,191})/read', $GLOBALS['moda_interact_registered_rest_routes'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->history( new WP_REST_Request( 'GET' ) )->get_status() );
		self::assertSame( 403, $controller->compose( self::compose( 'Hello', 'action-1' ) )->get_status() );
		self::assertSame( 403, $controller->markRead( self::markRead( 'message-1' ) )->get_status() );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->history( new WP_REST_Request( 'GET' ) )->get_status() );
		self::assertSame( 403, $controller->compose( self::compose( 'Hello', 'action-1' ) )->get_status() );
	}

	public function test_history_proxies_three_message_kinds_with_installation_credentials_only(): void {
		$calls = array();
		$controller = $this->controller( static function ( $url, $options ) use ( &$calls ) {
			$calls[] = array( $url, $options );
			return self::response( 200, self::page() );
		} );
		$result = $controller->history( new WP_REST_Request( 'GET', array( 'page' => '1', 'pageSize' => '25', '_locale' => 'user' ) ) );
		self::assertSame( 200, $result->get_status() );
		self::assertSame( array( 'MERCHANT', 'ADMINISTRATIVE', 'SYSTEM' ), array_column( $result->get_data()['items'], 'kind' ) );
		self::assertSame( 2, $result->get_data()['unread'] );
		self::assertSame( 'private, no-store', $result->get_headers()['Cache-Control'] );
		self::assertCount( 1, $calls );
		self::assertSame( 'https://api.example.test/v1/merchant/support/messages?page=1&pageSize=25', $calls[0][0] );
		self::assertSame( 'Bearer ' . self::record()['credential'], $calls[0][1]['headers']['Authorization'] );
		self::assertSame( self::record()['installationId'], $calls[0][1]['headers']['X-Moda-Installation-Id'] );
		self::assertArrayNotHasKey( 'body', $calls[0][1] );
		self::assertSame( 0, $calls[0][1]['redirection'] );
	}

	public function test_strict_browser_inputs_are_rejected_without_network(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) {
			$calls++;
			return self::response( 200, self::page() );
		} );
		foreach ( array(
			new WP_REST_Request( 'GET', array( 'shopId' => 'foreign' ) ),
			new WP_REST_Request( 'GET', array( 'page' => '0' ) ),
			new WP_REST_Request( 'GET', array( 'pageSize' => '51' ) ),
			new WP_REST_Request( 'GET', array( '_locale' => 'fr_FR' ) ),
		) as $invalid ) self::assertSame( 400, $controller->history( $invalid )->get_status() );
		foreach ( array(
			self::compose( '', 'action-1' ),
			self::compose( str_repeat( 'a', 501 ), 'action-1' ),
			self::compose( 'Hello', 'invalid/action' ),
			self::compose( 'Hello', 'action-1', array( 'shopId' => 'foreign' ) ),
		) as $invalid ) self::assertSame( 400, $controller->compose( $invalid )->get_status() );
		$bad = self::markRead( 'foreign' );
		$bad->set_url_params( array( 'messageId' => 'foreign', 'shopId' => 'foreign' ) );
		self::assertSame( 400, $controller->markRead( $bad )->get_status() );
		self::assertSame( 0, $calls );
	}

	public function test_compose_accepts_500_unicode_graphemes_and_forwards_exact_action_id(): void {
		self::assertTrue( SupportResponseValidator::body( str_repeat( '👩‍💻', 500 ) ) );
		self::assertFalse( SupportResponseValidator::body( str_repeat( '👩‍💻', 501 ) ) );
		$seen = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$seen ) {
			$seen[] = array( $url, $args );
			return self::response( 201, self::receipt() );
		} );
		self::assertSame( self::receipt(), $controller->compose( self::compose( '👩‍💻', 'action-stable' ) )->get_data() );
		self::assertSame( self::receipt(), $controller->compose( self::compose( '👩‍💻', 'action-stable' ) )->get_data() );
		self::assertSame( array( 'body' => '👩‍💻', 'actionId' => 'action-stable' ), json_decode( $seen[0][1]['body'], true ) );
		self::assertSame( $seen[0][1]['body'], $seen[1][1]['body'] );
		self::assertArrayNotHasKey( 'shopId', json_decode( $seen[0][1]['body'], true ) );
		self::assertSame( 'application/json', $seen[0][1]['headers']['Content-Type'] );
	}

	public function test_mark_read_is_tenant_scoped_and_preserves_hosted_timestamp(): void {
		$calls = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$calls ) {
			$calls[] = array( $url, $args );
			return self::response( 200, self::readReceipt() );
		} );
		$reply = $controller->markRead( self::markRead( 'message-1' ) );
		self::assertSame( self::readReceipt(), $reply->get_data() );
		self::assertSame( 'https://api.example.test/v1/merchant/support/messages/message-1/read', $calls[0][0] );
		self::assertArrayNotHasKey( 'body', $calls[0][1] );
		self::assertSame( 200, $reply->get_status() );
	}

	public function test_restricted_and_revoked_installations_fail_closed(): void {
		$controller = $this->controller( static fn() => self::response( 401, array( 'error' => 'unauthorized' ) ) );
		self::assertSame( 'RECONNECT_REQUIRED', $controller->history( new WP_REST_Request( 'GET' ) )->get_data()['status'] );
		$controller = $this->controller( static fn() => self::response( 403, array( 'error' => 'support_unavailable' ) ) );
		self::assertSame( 'SUPPORT_UNAVAILABLE', $controller->compose( self::compose( 'Hello', 'action-1' ) )->get_data()['status'] );
		$controller = $this->controller( static fn() => self::response( 404, array( 'error' => 'not_found' ) ) );
		self::assertSame( 'NOT_FOUND', $controller->markRead( self::markRead( 'foreign' ) )->get_data()['status'] );
		$controller = $this->controller( static fn() => self::response( 409, array( 'error' => 'idempotency_conflict' ) ) );
		self::assertSame( 'ACTION_CONFLICT', $controller->compose( self::compose( 'Different body', 'action-1' ) )->get_data()['status'] );
		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 401, $controller->history( new WP_REST_Request( 'GET' ) )->get_status() );
	}

	public function test_rotated_credentials_and_malformed_hosted_responses_cannot_claim_success(): void {
		$store = new InstallationStore();
		$controller = $this->controller( static function () use ( $store ) {
			$next = self::record();
			$next['credentialVersion'] = 3;
			$store->save( $next );
			return self::response( 201, self::receipt() );
		} );
		self::assertSame( 'RECONNECT_REQUIRED', $controller->compose( self::compose( 'Hello', 'action-1' ) )->get_data()['status'] );
		foreach ( array(
			array_merge( self::page(), array( 'credential' => 'secret' ) ),
			array_merge( self::page(), array( 'items' => array( array_merge( self::message( 'MERCHANT' ), array( 'shopId' => 'foreign' ) ) ) ) ),
		) as $malformed ) {
			$controller = $this->controller( static fn() => self::response( 200, $malformed ) );
			self::assertSame( 'REMOTE_RESPONSE_INVALID', $controller->history( new WP_REST_Request( 'GET' ) )->get_data()['status'] );
		}
		$controller = $this->controller( static fn() => self::response( 201, array_merge( self::receipt(), array( 'sent' => true ) ) ) );
		self::assertSame( 'REMOTE_RESPONSE_INVALID', $controller->compose( self::compose( 'Hello', 'action-1' ) )->get_data()['status'] );
	}

	private function controller( callable $transport ): SupportController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::record() ) );
		return new SupportController(
			new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport ),
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ),
			$store
		);
	}

	private static function compose( string $body, string $action_id, array $extra = array() ): WP_REST_Request {
		return new WP_REST_Request( 'POST', array(), array_merge( array( 'body' => $body, 'actionId' => $action_id ), $extra ),
			array(), array( 'X-WP-Nonce' => 'fixture_rest_nonce', 'Content-Type' => 'application/json' ) );
	}

	private static function markRead( string $id ): WP_REST_Request {
		$request = new WP_REST_Request( 'POST' );
		$request->set_url_params( array( 'messageId' => $id ) );
		return $request;
	}

	private static function record(): array {
		return array(
			'schemaVersion' => 1, 'installationId' => 'install_123', 'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2, 'connectedAt' => '2026-10-03T12:00:00+00:00',
		);
	}

	private static function message( string $kind ): array {
		return array( 'id' => strtolower( $kind ) . '-1', 'kind' => $kind, 'state' => 'AVAILABLE',
			'originalBody' => 'Original', 'displayBody' => 'Bonjour', 'isTranslated' => true,
			'sourceLanguageTag' => 'en', 'displayLanguageTag' => 'fr',
			'systemCode' => 'SYSTEM' === $kind ? 'BILLING_FREE_ALLOWANCE_WARNING' : null,
			'systemVersion' => 'SYSTEM' === $kind ? '1' : null,
			'createdAt' => '2026-10-21T12:00:00.000Z', 'readAt' => null );
	}

	private static function page(): array {
		return array( 'schemaVersion' => 1, 'page' => 1, 'pageSize' => 25,
			'total' => 3, 'totalPages' => 1, 'unread' => 2,
			'items' => array( self::message( 'MERCHANT' ), self::message( 'ADMINISTRATIVE' ), self::message( 'SYSTEM' ) ) );
	}

	private static function receipt(): array {
		return array( 'schemaVersion' => 1, 'messageId' => 'msg-1', 'translationId' => null );
	}

	private static function readReceipt(): array {
		return array( 'schemaVersion' => 1, 'messageId' => 'message-1', 'readAt' => '2026-10-21T12:30:00.000Z' );
	}

	private static function response( int $status, array $payload ): array {
		return array( 'headers' => array( 'content-type' => 'application/json' ),
			'body' => wp_json_encode( $payload ), 'response' => array( 'code' => $status ) );
	}
}
