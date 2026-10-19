<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\MerchantKnowledgeController;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

abstract class MerchantKnowledgeTestBase extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array();
		$GLOBALS['moda_interact_home_url'] = 'http://woocommerce-sandbox.local:8080';
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_registered_rest_routes'] = array();
	}

	protected static function record(): array {
		return array( 'schemaVersion' => 1, 'installationId' => 'install_123', 'shopId' => 'shop_456',
			'canonicalSiteUrl' => 'http://woocommerce-sandbox.local:8080',
			'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ), 'credentialVersion' => 2,
			'connectedAt' => '2026-10-03T12:00:00+00:00' );
	}
	protected function controller( callable $transport ): MerchantKnowledgeController {
		$store = new InstallationStore();
		self::assertTrue( $store->save( self::record() ) );
		return new MerchantKnowledgeController(
			new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport ),
			new SiteIdentity( ModaApiConfiguration::MODE_LOCAL_DEVELOPMENT, static fn() => array( '127.0.0.1' ) ),
			$store
		);
	}
	protected static function response( int $status, array $payload ): array {
		return array( 'headers' => array( 'content-type' => 'application/json' ),
			'body' => wp_json_encode( $payload ), 'response' => array( 'code' => $status ) );
	}
	protected static function request( string $route, string $method = 'GET', ?array $json = null,
		array $body = array(), array $query = array() ): WP_REST_Request {
		$headers = array( 'X-WP-Nonce' => 'fixture_rest_nonce' );
		if ( null !== $json ) $headers['Content-Type'] = 'application/json';
		$request = new WP_REST_Request( $method, $query, $json, $body, $headers );
		$request->set_route( '/moda-interact/v1/merchant/' . $route );
		if ( preg_match( '#/(?:sources|uploads)/([A-Za-z0-9_-]{1,128})(?:/refresh|/reprocess)?$#', $route, $matches ) ) {
			$request->set_url_params( array( 'id' => $matches[1] ) );
		}
		return $request;
	}
	protected static function feature(): array {
		return array( 'schemaVersion' => 1, 'revision' => str_repeat( 'a', 64 ),
			'features' => array( array( 'id' => 'feature_1', 'key' => 'merchant_knowledge', 'name' => 'Merchant Knowledge',
				'description' => null, 'enabled' => true, 'effective' => true, 'editable' => true,
				'required' => false, 'planEligible' => true ) ) );
	}
}
