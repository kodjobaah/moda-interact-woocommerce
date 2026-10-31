<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\WooRestoreResolveResponseValidator;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/Api/WooRestoreResolveResponseValidator.php';

final class WooRestoreResolveResponseValidatorTest extends TestCase {
	private array $connection;
	private array $response;
	private array $requests = array();

	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$this->connection = array(
			'schemaVersion' => 1, 'installationId' => 'install-one', 'shopId' => 'shop-one',
			'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( "\x02", 32 ) ),
			'credentialVersion' => 1, 'connectedAt' => '2026-10-20T12:00:00.000Z',
		);
		self::assertTrue( ( new InstallationStore() )->save( $this->connection ) );
		$fixture = json_decode( file_get_contents( __DIR__ . '/fixtures/woo-restore-v1.json' ), true );
		$this->response = $fixture['eligibleResolveResponse'];
		$this->response['snapshot']['appliedCouponCodes'] = array();
		$this->response['outreachOffer'] = array( 'kind' => 'NONE', 'reason' => 'NO_CONFIRMED_OFFER' );
		$this->requests = array();
	}

	public function test_resolver_posts_only_link_identity_with_installation_auth_and_accepts_complete_v1(): void {
		$client = $this->client( 200, $this->response );
		$actual = $client->resolveWooRecoveryLink( $this->connection, 'recovery_456', str_repeat( 'A', 43 ) );
		self::assertSame( $this->response, $actual );
		self::assertCount( 1, $this->requests );
		[ $url, $args ] = $this->requests[0];
		self::assertSame( 'POST', $args['method'] );
		self::assertSame( '/v1/woocommerce/recovery-restore/resolve', parse_url( $url, PHP_URL_PATH ) );
		self::assertSame( '', parse_url( $url, PHP_URL_QUERY ) ?? '' );
		self::assertSame( 'install-one', $args['headers']['X-Moda-Installation-Id'] );
		self::assertSame( 'Bearer ' . $this->connection['credential'], $args['headers']['Authorization'] );
		self::assertSame( array( 'schemaVersion' => 'woo.restore.resolve.v1', 'recoveryId' => 'recovery_456', 'token' => str_repeat( 'A', 43 ) ), json_decode( $args['body'], true ) );
		self::assertArrayNotHasKey( 'checkoutKey', json_decode( $args['body'], true ) );
	}

	public function test_accepts_the_current_grouped_offer_union_but_does_not_apply_it(): void {
		$this->response['outreachOffer'] = array( 'kind' => 'CHECKOUT_OFFERS', 'offers' => array(
			array( 'method' => 'CODE', 'code' => 'OFFER10', 'providerDiscountId' => 'woo:coupon:10' ),
			array( 'method' => 'AUTOMATIC', 'providerDiscountId' => 'woo:discount:22' ),
		) );
		self::assertTrue( WooRestoreResolveResponseValidator::isValid( json_decode( wp_json_encode( $this->response ) ), 'recovery_456' ) );
	}

	public function test_rejects_extra_fields_bad_ids_bad_snapshot_and_incomplete_offer(): void {
		$mutations = array(
			static function ( array &$value ): void { $value['customer'] = array(); },
			static function ( array &$value ): void { $value['checkoutKey'] = "key\n"; },
			static function ( array &$value ): void { $value['snapshot']['lines'][0]['metadata'] = 'ignored'; },
			static function ( array &$value ): void { $value['snapshot']['lines'][0]['quantity'] = 0; },
			static function ( array &$value ): void { $value['outreachOffer'] = array( 'kind' => 'NONE' ); },
			static function ( array &$value ): void { $value['outreachOffer'] = array( 'kind' => 'CHECKOUT_OFFERS', 'offers' => array() ); },
		);
		foreach ( $mutations as $mutate ) {
			$payload = $this->response;
			$mutate( $payload );
			self::assertFalse( WooRestoreResolveResponseValidator::isValid( json_decode( wp_json_encode( $payload ) ), 'recovery_456' ) );
		}
	}

	public function test_resolver_rejects_wrong_recovery_id_and_uniform_denial(): void {
		$wrong = $this->client( 200, $this->response );
		try {
			$wrong->resolveWooRecoveryLink( $this->connection, 'other-recovery', str_repeat( 'A', 43 ) );
			self::fail( 'Mismatched response ID must be rejected' );
		} catch ( ModaApiClientException $error ) {
			self::assertSame( 'remote_response_invalid', $error->getMessage() );
		}
		$denied = $this->client( 404, array( 'error' => 'restore_unavailable' ) );
		try {
			$denied->resolveWooRecoveryLink( $this->connection, 'recovery_456', str_repeat( 'A', 43 ) );
			self::fail( 'Denied links must not produce a response' );
		} catch ( ModaApiClientException $error ) {
			self::assertSame( 'not_found', $error->getMessage() );
			self::assertSame( 404, $error->http_status );
		}
	}

	private function client( int $status, array $payload ): ModaApiClient {
		return new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			function ( string $url, array $args ) use ( $status, $payload ) {
				$this->requests[] = array( $url, $args );
				return array( 'response' => array( 'code' => $status ), 'headers' => array( 'content-type' => 'application/json' ), 'body' => wp_json_encode( $payload ) );
			} );
	}
}