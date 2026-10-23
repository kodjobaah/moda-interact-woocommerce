<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\RecoverySelectionContracts;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\RecoverySelectionController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/Api/RecoverySelectionContracts.php';
require_once dirname( __DIR__ ) . '/includes/Rest/RecoverySelectionController.php';

final class RecoverySelectionControllerTest extends TestCase {
	private const PHONE = '447400123477';

	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	public function test_wp_capability_and_nonce_are_required_for_both_routes(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) { $calls++; return self::response( self::selectionStatus() ); } );
		$controller->registerRoutes();
		self::assertCount( 2, $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/customer-recovery-selection'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->status( $this->lookup() )->get_status() );
		self::assertSame( 403, $controller->command( $this->command() )->get_status() );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->status( $this->lookup() )->get_status() );
		self::assertSame( 403, $controller->command( $this->command() )->get_status() );
		self::assertSame( 0, $calls );
	}

	public function test_lookup_passes_only_one_phone_with_installation_and_server_admin_assertion(): void {
		$calls = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$calls ) {
			$calls[] = array( $url, $args );
			return self::response( self::selectionStatus() );
		} );
		$reply = $controller->status( $this->lookup() );
		self::assertSame( 200, $reply->get_status() );
		self::assertSame( 'private, no-store', $reply->get_headers()['Cache-Control'] );
		self::assertSame( self::selectionStatus(), $reply->get_data() );
		self::assertCount( 1, $calls );
		self::assertSame( 'https://api.example.test/v1/woocommerce/customer-recovery-selection?canonicalPhone=' . self::PHONE, $calls[0][0] );
		self::assertSame( '1', $calls[0][1]['headers']['X-Moda-WP-Admin-Verified'] );
		self::assertSame( 'install_123', $calls[0][1]['headers']['X-Moda-Installation-Id'] );
		self::assertSame( 'Bearer ' . self::record()['credential'], $calls[0][1]['headers']['Authorization'] );
		self::assertArrayNotHasKey( 'body', $calls[0][1] );
		self::assertSame( 0, $calls[0][1]['redirection'] );
	}

	public function test_rejects_unknown_fields_and_invalid_stop_reference_before_network(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) { $calls++; return self::response( self::selectionStatus() ); } );
		foreach ( array(
			new WP_REST_Request( 'GET', array( 'shopId' => 'other', 'canonicalPhone' => self::PHONE ) ),
			new WP_REST_Request( 'GET', array( 'canonicalPhone' => '+447400123477' ) ),
			new WP_REST_Request( 'GET', array( 'canonicalPhone' => self::PHONE, 'customerId' => 'foreign' ) ),
		) as $request ) self::assertSame( 400, $controller->status( $request )->get_status() );
		foreach ( array(
			array_merge( self::commandData(), array( 'shopId' => 'foreign' ) ),
			array_merge( self::commandData(), array( 'action' => 'REENABLE', 'evidenceReference' => 'ticket-1' ) ),
			array_merge( self::commandData(), array( 'action' => 'RECORD_CUSTOMER_STOP', 'evidenceReference' => null ) ),
			array_merge( self::commandData(), array( 'expectedNoContactRevision' => 0 ) ),
			array_merge( self::commandData(), array( 'canonicalPhone' => '447400123477999999' ) ),
		) as $input ) self::assertSame( 400, $controller->command( $this->command( $input ) )->get_status() );
		self::assertSame( 0, $calls );
	}

	public function test_stop_is_forwarded_with_revision_and_opaque_reference_without_shop_selector(): void {
		$calls = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$calls ) {
			$calls[] = array( $url, $args );
			return self::response( array_merge( self::selectionStatus( 'CUSTOMER_STOP' ), array( 'outcome' => 'updated' ) ) );
		} );
		$input = array_merge( self::commandData(), array( 'action' => 'RECORD_CUSTOMER_STOP', 'evidenceReference' => 'case-ABC_123' ) );
		$reply = $controller->command( $this->command( $input ) );
		self::assertSame( 200, $reply->get_status() );
		self::assertSame( 'CUSTOMER_STOP', $reply->get_data()['suppressionReason'] );
		self::assertSame( $input, json_decode( $calls[0][1]['body'], true ) );
		self::assertSame( 'POST', $calls[0][1]['method'] );
		self::assertSame( '1', $calls[0][1]['headers']['X-Moda-WP-Admin-Verified'] );
	}

	public function test_conflicts_and_malformed_responses_fail_closed(): void {
		$controller = $this->controller( static fn() => self::response( array( 'error' => 'customer_stop_authoritative' ), 409 ) );
		self::assertSame( 'CUSTOMER_STOP_AUTHORITATIVE', $controller->command( $this->command() )->get_data()['status'] );
		$controller = $this->controller( static fn() => self::response( array( 'error' => 'ambiguous_customer_phone' ), 409 ) );
		self::assertSame( 409, $controller->status( $this->lookup() )->get_status() );
		$controller = $this->controller( static fn() => self::response( array_merge( self::selectionStatus(), array( 'customerId' => 'foreign' ) ) ) );
		self::assertSame( 502, $controller->status( $this->lookup() )->get_status() );
	}

	public function test_rotated_credentials_and_disconnected_installation_never_claim_success(): void {
		$store = new InstallationStore();
		$controller = $this->controller( static function () use ( $store ) {
			$record = self::record(); $record['credentialVersion'] = 3; $store->save( $record );
			return self::response( self::selectionStatus() );
		} );
		self::assertSame( 409, $controller->status( $this->lookup() )->get_status() );
		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 401, $controller->status( $this->lookup() )->get_status() );
	}

	private function controller( callable $transport ): RecoverySelectionController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::record() ) );
		return new RecoverySelectionController(
			new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport ),
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ), $store );
	}

	private function lookup(): WP_REST_Request {
		return new WP_REST_Request( 'GET', array( 'canonicalPhone' => self::PHONE ) );
	}

	private function command( ?array $data = null ): WP_REST_Request {
		return new WP_REST_Request( 'POST', array(), $data ?? self::commandData(), array(),
			array( 'X-WP-Nonce' => 'fixture_rest_nonce', 'Content-Type' => 'application/json' ) );
	}

	private static function commandData(): array {
		return array( 'schemaVersion' => RecoverySelectionContracts::VERSION, 'canonicalPhone' => self::PHONE,
			'action' => 'SUPPRESS', 'expectedNoContactRevision' => '0', 'evidenceReference' => null );
	}

	private static function selectionStatus( ?string $reason = null ): array {
		return array( 'schemaVersion' => RecoverySelectionContracts::VERSION, 'consentDecision' => 'GRANTED',
			'suppressed' => null !== $reason, 'suppressionReason' => $reason, 'noContactRevision' => null === $reason ? '0' : '1',
			'phoneEligibleForRecovery' => null === $reason, 'canReenable' => 'MERCHANT_OPT_OUT' === $reason );
	}

	private static function record(): array {
		return array( 'schemaVersion' => 1, 'installationId' => 'install_123', 'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2, 'connectedAt' => '2026-10-03T12:00:00+00:00' );
	}

	private static function response( array $payload, int $code = 200 ): array {
		return array( 'headers' => array( 'content-type' => 'application/json' ),
			'body' => wp_json_encode( $payload ), 'response' => array( 'code' => $code ) );
	}
}
