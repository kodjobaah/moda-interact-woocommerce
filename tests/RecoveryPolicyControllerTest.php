<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\RecoveryPolicyResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\RecoveryPolicyController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

if ( ! function_exists( 'wc_get_logger' ) ) {
	function wc_get_logger() {
		return $GLOBALS['moda_interact_test_logger'];
	}
}

final class RecoveryPolicyTestLogger {
	public array $errors = array();
	public function error( string $message, array $context = array() ): void {
		$this->errors[] = array( $message, $context );
	}
}

final class RecoveryPolicyControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_test_logger'] = new RecoveryPolicyTestLogger();
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_get_put_permissions_and_installation_only_identity(): void {
		$sent = array();
		$controller = $this->controller( static function ( string $url, array $args ) use ( &$sent ) {
			$sent[] = array( $url, $args );
			return self::response( 200, self::policy() );
		} );
		$controller->registerRoutes();
		$route = $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/recovery-policy'];
		self::assertSame( array( 'GET', 'PUT' ), $route['methods'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( new WP_REST_Request() )->get_error_data()['status'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( new WP_REST_Request() )->get_error_data()['status'] );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		self::assertTrue( $controller->authorizeAdministrator( new WP_REST_Request() ) );

		$read = $controller->handle( new WP_REST_Request( 'GET' ) );
		self::assertSame( 200, $read->get_status() );
		self::assertSame( self::policy(), $read->get_data() );
		self::assertSame( 'private, no-store', $read->get_headers()['Cache-Control'] );

		$save = $controller->handle( self::put( self::update() ) );
		self::assertSame( 200, $save->get_status() );
		self::assertCount( 2, $sent );
		self::assertSame( 'https://api.example.test/v1/merchant/recovery-policy', $sent[1][0] );
		self::assertSame( 'PUT', $sent[1][1]['method'] );
		self::assertSame( self::update(), json_decode( $sent[1][1]['body'], true ) );
		self::assertArrayNotHasKey( 'shopId', json_decode( $sent[1][1]['body'], true ) );
		self::assertSame( 'Bearer ' . self::record()['credential'], $sent[1][1]['headers']['Authorization'] );
		self::assertSame( 'application/json', $sent[1][1]['headers']['Content-Type'] );
		self::assertSame( 0, $sent[1][1]['redirection'] );
	}

	public function test_rejects_browser_shop_and_unapproved_provider_fields_without_network(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) {
			$calls++;
			return self::response( 200, self::policy() );
		} );
		foreach ( array(
			new WP_REST_Request( 'GET', array( 'shopId' => 'foreign-shop' ) ),
			self::put( array_merge( self::update(), array( 'fixedShopifyDiscountId' => 'secret' ) ) ),
			self::put( array_merge( self::update(), array( 'recoveryOfferMode' => 'FIXED' ) ) ),
			self::put( array_merge( self::update(), array( 'shopId' => 'another-shop' ) ) ),
			self::put( array_merge( self::update(), array( 'followUpDelayMinutes' => 0 ) ) ),
			self::put( array_merge( self::update(), array( 'expectedRevision' => 'invalid' ) ) ),
			new WP_REST_Request( 'GET', array(), self::update() ),
		) as $invalid ) self::assertSame( 400, $controller->handle( $invalid )->get_status() );
		self::assertSame( 0, $calls );
	}

	public function test_conflict_and_unverified_responses_are_not_exposed(): void {
		foreach ( array(
			array( 409, array( 'error' => 'recovery_policy_conflict' ), 'POLICY_CONFLICT' ),
			array( 409, array( 'error' => 'recovery_offer_unsupported' ), 'OFFER_UNSUPPORTED' ),
			array( 409, array( 'error' => 'recovery_policy_integrity_invalid' ), 'POLICY_UNAVAILABLE' ),
			array( 401, array( 'error' => 'unauthorized' ), 'RECONNECT_REQUIRED' ),
			array( 200, array_merge( self::policy(), array( 'credential' => 'leak' ) ), 'REMOTE_RESPONSE_INVALID' ),
		) as $case ) {
			$controller = $this->controller( static fn() => self::response( $case[0], $case[1] ) );
			$reply = $controller->handle( self::put( self::update() ) );
			self::assertSame( array( 'status' => $case[2] ), $reply->get_data() );
		}
		self::assertFalse( RecoveryPolicyResponseValidator::isValid( array_merge( self::policy(), array( 'secret' => 'leak' ) ) ) );
		self::assertFalse( RecoveryPolicyResponseValidator::isUpdate( array_merge( self::update(), array( 'recoveryOfferMode' => 'FIXED' ) ) ) );
		self::assertFalse( RecoveryPolicyResponseValidator::isValid( array_diff_key( self::policy(), array( 'notifyOnInitialRecoveryOutreach' => true ) ) ) );
		self::assertFalse( RecoveryPolicyResponseValidator::isValid( array_merge( self::policy(), array( 'notifyOnInitialRecoveryOutreach' => 'true' ) ) ) );
		self::assertFalse( RecoveryPolicyResponseValidator::isUpdate( array_diff_key( self::update(), array( 'notifyOnInitialRecoveryOutreach' => true ) ) ) );
		self::assertFalse( RecoveryPolicyResponseValidator::isUpdate( array_merge( self::update(), array( 'notifyOnInitialRecoveryOutreach' => 'true' ) ) ) );
		self::assertTrue( RecoveryPolicyResponseValidator::isValid( self::policy( false ) ) );
		self::assertTrue( RecoveryPolicyResponseValidator::isUpdate( array_merge( self::update(), array( 'notifyOnInitialRecoveryOutreach' => false ) ) ) );
	}

	public function test_missing_installation_fails_without_network(): void {
		$controller = $this->controller( static function () { throw new LogicException( 'Must not call API' ); } );
		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 401, $controller->handle( self::put( self::update() ) )->get_status() );
	}

	public function test_unexpected_persistence_failure_is_logged_without_exception_text(): void {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::record() ) );
		$api = new class( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), static fn() => array() ) extends ModaApiClient {
			public function merchantRecoveryPolicy( array $connection, ?array $update = null ): array {
				throw new RuntimeException( 'private persistence detail' );
			}
		};
		$controller = new RecoveryPolicyController(
			$api,
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ),
			$store
		);
		$reply = $controller->handle( self::put( self::update() ) );
		self::assertSame( 503, $reply->get_status() );
		self::assertSame( array( 'status' => 'REMOTE_UNAVAILABLE' ), $reply->get_data() );
		self::assertCount( 1, $GLOBALS['moda_interact_test_logger']->errors );
		[ $message, $context ] = $GLOBALS['moda_interact_test_logger']->errors[0];
		self::assertSame( 'Recovery policy proxy request failed.', $message );
		self::assertSame( 'RuntimeException', $context['error_class'] );
		self::assertSame( '0', $context['error_code'] );
		self::assertArrayNotHasKey( 'private persistence detail', $context );
	}

	private function controller( callable $transport ): RecoveryPolicyController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::record() ) );
		return new RecoveryPolicyController(
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
		return array(
			'expectedRevision' => '2026-10-12T10:00:00.000Z',
			'recoveryDelayMinutes' => 45,
			'followUpEnabled' => true,
			'followUpDelayMinutes' => 120,
			'notifyOnInitialRecoveryOutreach' => true,
		);
	}

	private static function policy( bool $notify = true ): array {
		return array(
			'schemaVersion' => 2,
			'revision' => '2026-10-12T10:00:00.000Z',
			'merchant' => array(
				'recoveryDelayMinutes' => 45, 'recoveryOfferMode' => 'NONE',
				'followUpEnabled' => true, 'followUpDelayMinutes' => 120,
			),
			'effective' => array(
				'recoveryDelayMinutes' => 30, 'recoveryOfferMode' => 'NONE',
				'followUpEnabled' => false, 'followUpDelayMinutes' => null,
			),
			'source' => 'ADMIN_OVERRIDE',
			'overrideActive' => true,
			'offerSelectionAvailable' => false,
			'notifyOnInitialRecoveryOutreach' => $notify,
		);
	}

	private static function record(): array {
		return array(
			'schemaVersion' => 1,
			'installationId' => 'install_123', 'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
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
