<?php

use ModaInteract\WooCommerce\Api\ConversationCommandContracts;
use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\RecoveryConversationCommandController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class RecoveryConversationCommandControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	private static function installation(): array {
		return array( 'schemaVersion' => 1, 'installationId' => 'install_1', 'shopId' => 'shop_1',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2, 'connectedAt' => '2026-10-23T10:00:00+00:00' );
	}

	private static function summary(): array {
		return array( 'schemaVersion' => 1, 'id' => 'rec_1', 'status' => 'ENGAGED', 'timeZone' => 'Europe/London',
			'value' => array( 'amount' => '10.00', 'currency' => 'GBP', 'incomplete' => false ),
			'customer' => null, 'hasConversation' => true,
			'basket' => array( 'items' => array(), 'recoveryTotal' => array( 'amount' => '10.00', 'currency' => 'GBP' ), 'unavailableReason' => 'missing_snapshot' ),
			'conversation' => array( 'id' => 'conv_1', 'controlMode' => 'AI', 'controlRevision' => 4,
				'lastInboundAt' => null, 'windowExpiresAt' => null,
				'followUp' => array( 'sequence2Used' => false, 'initiatedBy' => null ) ),
			'humanMessagingAllowed' => true, 'humanMessagingStatus' => 'ACTIVE',
			'milestones' => array( 'detectedAt' => '2026-10-22T12:00:00.000Z', 'messageSentAt' => null,
				'engagedAt' => null, 'completedAt' => null, 'expiredAt' => null ) );
	}

	private static function control(): array {
		return array( 'schemaVersion' => 1, 'conversationId' => 'conv_1', 'controlMode' => 'HUMAN',
			'controlRevision' => 5, 'controlChangedAt' => null );
	}

	private static function request( string $operation, ?array $body = null ): WP_REST_Request {
		$request = new WP_REST_Request( 'status' === $operation ? 'GET' : 'POST', array(), $body );
		$request->set_url_params( 'status' === $operation ? array( 'recoveryId' => 'rec_1', 'commandId' => 'cmd_1' ) : array( 'recoveryId' => 'rec_1' ) );
		if ( 'status' !== $operation ) $request->set_header( 'Content-Type', 'application/json' );
		return $request;
	}

	private function controller( array &$calls, array $reply, int $code = 200 ): RecoveryConversationCommandController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::installation() ) );
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function ( string $url, array $options ) use ( &$calls, $reply, $code ): array {
				$calls[] = array( $url, $options );
				$is_read = str_contains( $url, '/recoveries/rec_1' );
				return array( 'headers' => array( 'content-type' => 'application/json' ),
					'body' => wp_json_encode( $is_read ? self::summary() : $reply ),
					'response' => array( 'code' => $is_read ? 200 : $code ) );
			} );
		return new RecoveryConversationCommandController( $client,
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ), $store );
	}

	public function test_local_routes_guard_capability_nonce_and_derive_conversation_from_recovery(): void {
		$calls = array(); $controller = $this->controller( $calls, self::control() );
		$controller->registerRoutes(); self::assertCount( 3, $GLOBALS['moda_interact_registered_rest_routes'] );
		$request = self::request( 'control', array( 'targetMode' => 'HUMAN', 'expectedControlRevision' => 4 ) );
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->handle( $request, 'control' )->get_status() );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->handle( $request, 'control' )->get_status() );
		self::assertSame( array(), $calls );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$result = $controller->handle( $request, 'control' );
		self::assertSame( 200, $result->get_status() );
		self::assertSame( 'HUMAN', $result->get_data()['controlMode'] );
		self::assertCount( 2, $calls );
		self::assertSame( '/v1/merchant/recoveries/rec_1', parse_url( $calls[0][0], PHP_URL_PATH ) );
		self::assertSame( '/v1/merchant/conversations/conv_1/control', parse_url( $calls[1][0], PHP_URL_PATH ) );
		self::assertSame( 'Bearer ' . self::installation()['credential'], $calls[1][1]['headers']['Authorization'] );
		self::assertSame( 'private, no-store', $result->get_headers()['Cache-Control'] );
	}

	public function test_request_and_response_contracts_fail_closed(): void {
		self::assertFalse( ConversationCommandContracts::request( array( 'targetMode' => 'HUMAN', 'expectedControlRevision' => 4, 'shopId' => 'foreign' ), 'control' ) );
		self::assertFalse( ConversationCommandContracts::request( array( 'targetMode' => 'AI', 'expectedControlRevision' => -1 ), 'control' ) );
		self::assertTrue( ConversationCommandContracts::request( array( 'kind' => 'HUMAN_TEXT', 'expectedControlRevision' => 4,
			'idempotencyKey' => 'intent_1', 'textBody' => 'Hello' ), 'messages' ) );
		self::assertFalse( ConversationCommandContracts::request( array( 'kind' => 'HUMAN_TEXT', 'expectedControlRevision' => 4,
			'idempotencyKey' => 'intent_1', 'textBody' => 'Hello', 'shopId' => 'foreign' ), 'messages' ) );
		self::assertFalse( ConversationCommandContracts::response( array_merge( self::control(), array( 'credential' => 'secret' ) ), 'control', 'conv_1' ) );
		$calls = array(); $controller = $this->controller( $calls, array_merge( self::control(), array( 'credential' => 'secret' ) ) );
		self::assertSame( 502, $controller->handle( self::request( 'control', array( 'targetMode' => 'HUMAN', 'expectedControlRevision' => 4 ) ), 'control' )->get_status() );
	}

	public function test_invalid_input_never_reaches_hosted_api(): void {
		$calls = array(); $controller = $this->controller( $calls, self::control() );
		$bad = self::request( 'control', array( 'targetMode' => 'HUMAN', 'expectedControlRevision' => 4, 'shopId' => 'foreign' ) );
		self::assertSame( 400, $controller->handle( $bad, 'control' )->get_status() );
		self::assertSame( array(), $calls );
	}
}
