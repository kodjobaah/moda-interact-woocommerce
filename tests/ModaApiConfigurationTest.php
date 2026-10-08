<?php

use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use PHPUnit\Framework\TestCase;

final class ModaApiConfigurationTest extends TestCase {
	public function test_missing_server_origin_defaults_to_production_https_origin(): void {
		$previous_origin = getenv( 'MODA_INTERACT_API_BASE_URL' );
		putenv( 'MODA_INTERACT_API_BASE_URL' );
		try {
			$config = ModaApiConfiguration::fromServerConfiguration();
		} finally {
			if ( false === $previous_origin ) {
				putenv( 'MODA_INTERACT_API_BASE_URL' );
			} else {
				putenv( 'MODA_INTERACT_API_BASE_URL=' . $previous_origin );
			}
		}

		self::assertSame( 'https://api.modainteract.com', $config->base_url );
		self::assertSame( ModaApiConfiguration::MODE_PUBLIC, $config->mode );
	}

	public function test_public_mode_requires_https_and_a_dns_host(): void {
		$config = ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test:8443/' );
		self::assertSame( 'https://api.example.test:8443', $config->base_url );
		self::assertSame( ModaApiConfiguration::MODE_PUBLIC, $config->mode );

		foreach ( array( 'http://api.example.test', 'https://127.0.0.1', 'https://user:pass@api.example.test' ) as $url ) {
			try {
				ModaApiConfiguration::fromServerConfiguration( $url );
				self::fail( 'Expected invalid public API origin: ' . $url );
			} catch ( ModaApiConfigurationException $error ) {
				self::assertSame( 'api_not_configured', $error->getMessage() );
			}
		}
	}

	public function test_local_development_accepts_local_origins_only(): void {
		$config = ModaApiConfiguration::fromServerConfiguration(
			'http://127.0.0.1:8080/',
			ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT
		);
		self::assertSame( 'http://127.0.0.1:8080', $config->base_url );
		$docker_host = ModaApiConfiguration::fromServerConfiguration(
			'http://host.docker.internal:8080',
			ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT
		);
		self::assertSame( 'host.docker.internal', parse_url( $docker_host->base_url, PHP_URL_HOST ) );

		foreach ( array( 'http://api.example.test', 'https://api.example.test' ) as $url ) {
			try {
				ModaApiConfiguration::fromServerConfiguration( $url, ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT );
				self::fail( 'Expected non-local API origin to be rejected: ' . $url );
			} catch ( ModaApiConfigurationException $error ) {
				self::assertSame( 'api_not_configured', $error->getMessage() );
			}
		}
	}
}