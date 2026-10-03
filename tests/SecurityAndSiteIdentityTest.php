<?php

use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Connection\SiteIdentityException;
use ModaInteract\WooCommerce\Security\Base64Url;
use ModaInteract\WooCommerce\Security\HmacProof;
use PHPUnit\Framework\TestCase;

final class SecurityAndSiteIdentityTest extends TestCase {
	public function test_base64url_round_trip_requires_canonical_exact_length(): void {
		$encoded = Base64Url::encode( str_repeat( "\x01", 32 ) );
		self::assertSame( 32, strlen( Base64Url::decode( $encoded, 32 ) ) );
		self::assertNull( Base64Url::decode( $encoded . '=', 32 ) );
		self::assertNull( Base64Url::decode( Base64Url::encode( 'short' ), 32 ) );
	}

	public function test_api_002_hmac_message_matches_fixed_vector(): void {
		$secret = str_repeat( "\x01", 32 );
		$proof  = HmacProof::create( $secret, '550e8400-e29b-41d4-a716-446655440000', str_repeat( 'A', 43 ), 'https://merchant.example/store' );
		self::assertSame( 'R18za0bLi7Z0Fs4y08zYufFn7X9ds-JMTVOO7LU6HrA', $proof );
	}

	public function test_local_identity_accepts_loopback_custom_port_and_rejects_public_http(): void {
		$identity = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) );
		self::assertSame( 'http://woocommerce-sandbox.local:8080/store', $identity->canonicalize( 'http://woocommerce-sandbox.local:8080/store/' ) );
		$private_dns = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '10.10.0.4' ) );
		self::assertSame( 'http://wordpress.internal', $private_dns->canonicalize( 'http://wordpress.internal' ) );

		$public = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '93.184.216.34' ) );
		foreach ( array( 'http://merchant.example', 'https://merchant.example:8443' ) as $url ) {
			try {
				$public->canonicalize( $url );
				self::fail( 'Expected public URL to be rejected under local-development policy: ' . $url );
			} catch ( SiteIdentityException $error ) {
				self::assertSame( 'site_url_invalid', $error->getMessage() );
			}
		}
	}

	public function test_local_identity_rejects_mixed_dns_answers_and_public_mode_rejects_ip(): void {
		$mixed = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1', '93.184.216.34' ) );
		try {
			$mixed->canonicalize( 'https://wordpress.local' );
			self::fail( 'Expected mixed answer set to be rejected.' );
		} catch ( SiteIdentityException $error ) {
			self::assertSame( 'site_url_invalid', $error->getMessage() );
		}

		$public = new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '127.0.0.1' ) );
		$this->expectException( SiteIdentityException::class );
		$public->canonicalize( 'https://127.0.0.1' );
	}

	public function test_connection_prerequisites_reject_plain_permalinks_and_incompatible_rest_url(): void {
		$identity = new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) );
		$GLOBALS['moda_interact_home_url'] = 'http://localhost:8080/store';
		$GLOBALS['moda_interact_options']['permalink_structure'] = '';
		try {
			$identity->assertConnectionPrerequisites();
			self::fail( 'Expected Plain permalinks to be rejected.' );
		} catch ( SiteIdentityException $error ) {
			self::assertSame( 'permalinks_required', $error->getMessage() );
		}

		$GLOBALS['moda_interact_options']['permalink_structure'] = '/%postname%/';
		$GLOBALS['moda_interact_rest_url'] = 'http://localhost:8080/wp-json/other/v1/connection/challenge';
		try {
			$identity->assertConnectionPrerequisites();
			self::fail( 'Expected an incompatible generated REST URL to be rejected.' );
		} catch ( SiteIdentityException $error ) {
			self::assertSame( 'rest_url_invalid', $error->getMessage() );
		} finally {
			unset( $GLOBALS['moda_interact_rest_url'] );
		}
	}
}