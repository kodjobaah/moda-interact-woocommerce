<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Connection\BootstrapAttemptStore;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class ConnectionStorageAndApiTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_option_autoload'] = array();
		$GLOBALS['moda_interact_transients'] = array();
		$GLOBALS['moda_interact_scheduled_events'] = array();
	}

	public function test_bootstrap_attempts_are_bounded_secret_safe_and_one_time(): void {
		$store      = new BootstrapAttemptStore();
		$attempt_id = '550e8400-e29b-41d4-a716-446655440000';
		$secret     = Base64Url::encode( str_repeat( "\x03", 32 ) );
		self::assertTrue( $store->create( $attempt_id, $secret, 'http://woocommerce-sandbox.local' ) );
		self::assertLessThanOrEqual( 120, $GLOBALS['moda_interact_transients'][ array_key_first( $GLOBALS['moda_interact_transients'] ) ]['expires'] - time() );

		$attempt = $store->consume( $attempt_id );
		self::assertSame( $secret, $attempt['bootstrapSecret'] );
		self::assertSame( array(), $GLOBALS['moda_interact_transients'] );
		self::assertNull( $store->consume( $attempt_id ) );
		self::assertNotEmpty( $GLOBALS['moda_interact_options'] );
		self::assertContains( false, $GLOBALS['moda_interact_option_autoload'] );
	}

	public function test_expired_bootstrap_attempt_cannot_be_consumed(): void {
		$store      = new BootstrapAttemptStore();
		$attempt_id = '550e8400-e29b-41d4-a716-446655440000';
		$secret     = Base64Url::encode( str_repeat( "\x03", 32 ) );
		self::assertTrue( $store->create( $attempt_id, $secret, 'http://woocommerce-sandbox.local' ) );
		$key = 'moda_interact_bootstrap_' . hash( 'sha256', $attempt_id );
		$GLOBALS['moda_interact_transients'][ $key ]['expires'] = time() - 1;
		self::assertNull( $store->consume( $attempt_id ) );
		self::assertSame( array(), $GLOBALS['moda_interact_transients'] );
	}

	public function test_installation_store_is_strict_and_non_autoloaded(): void {
		$store  = new InstallationStore();
		$record = self::connectionRecord();
		self::assertTrue( $store->save( $record ) );
		self::assertFalse( $GLOBALS['moda_interact_option_autoload'][ InstallationStore::OPTION_NAME ] );
		self::assertSame( array( 'state' => 'valid', 'record' => $record ), $store->read() );

		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ]['unexpected'] = true;
		self::assertSame( 'invalid', $store->read()['state'] );
	}

	public function test_api_client_uses_bounded_no_redirect_transport_and_exact_auth_headers(): void {
		$requests = array();
		$payload  = array(
			'installationId' => 'install_123',
			'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2,
			'connection' => 'RECONNECTED',
		);
		$client = new ModaApiClient(
			ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function ( string $url, array $args ) use ( &$requests, $payload ): array {
				$requests[] = array( $url, $args );
				return array(
					'headers' => array( 'content-type' => 'application/json; charset=utf-8' ),
					'body' => json_encode( $payload ),
					'response' => array( 'code' => 200 ),
				);
			}
		);
		$result = $client->connect( 'https://merchant.example', '550e8400-e29b-41d4-a716-446655440000', Base64Url::encode( str_repeat( "\x02", 32 ) ) );
		self::assertSame( $payload, $result );
		self::assertSame( 'https://api.example.test/v1/woocommerce/installations/connect', $requests[0][0] );		self::assertSame( 0, $requests[0][1]['redirection'] );
		self::assertSame( true, $requests[0][1]['sslverify'] );
		self::assertSame( array(), $requests[0][1]['cookies'] );
		self::assertArrayNotHasKey( 'Authorization', $requests[0][1]['headers'] );

		$probe_client = new ModaApiClient(
			ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function ( string $url, array $args ) use ( &$requests ): array {
				$requests[] = array( $url, $args );
				return array(
					'headers' => array( 'content-type' => 'application/json' ),
					'body' => json_encode( array(
						'installationId' => 'install_123',
						'shopId' => 'shop_456',
						'canonicalSiteUrl' => 'https://merchant.example',
						'credentialVersion' => 3,
					) ),
					'response' => array( 'code' => 200 ),
				);
			}
		);
		$record = self::connectionRecord();
		$record['credentialVersion'] = 3;
		$probe_client->probe( $record );
		$headers = $requests[1][1]['headers'];
		self::assertSame( 'install_123', $headers['X-Moda-Installation-Id'] );
		self::assertSame( 'Bearer ' . $record['credential'], $headers['Authorization'] );
		self::assertArrayNotHasKey( 'X-Shop-Id', $headers );
	}

	public function test_probe_maps_401_separately_from_remote_failure(): void {
		$client = new ModaApiClient(
			ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static fn() => array( 'headers' => array(), 'body' => '', 'response' => array( 'code' => 401 ) )
		);
		try {
			$client->probe( self::connectionRecord() );
			self::fail( 'Expected authentication rejection.' );
		} catch ( ModaApiClientException $error ) {
			self::assertSame( 'unauthorized', $error->getMessage() );
		}
	}

	private static function connectionRecord(): array {
		return array(
			'schemaVersion' => 1,
			'installationId' => 'install_123',
			'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ),
			'credentialVersion' => 2,
			'connectedAt' => '2026-10-03T12:00:00+00:00',
		);
	}
}