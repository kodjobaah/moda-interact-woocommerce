<?php

require_once __DIR__ . '/fixtures/MerchantKnowledgeTestBase.php';

use ModaInteract\WooCommerce\Api\MerchantKnowledgeContracts;
use ModaInteract\WooCommerce\Connection\InstallationStore;

final class MerchantKnowledgeControllerTest extends MerchantKnowledgeTestBase {

	public function test_route_auth_and_installed_identity(): void {
		$sent = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$sent ) {
			$sent[] = array( $url, $args );
			return self::response( 200, self::feature() );
		} );
		$controller->registerRoutes();
		self::assertCount( 10, $GLOBALS['moda_interact_registered_rest_routes'] );
		$read = self::request( 'feature-preferences' );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->handle( $read )->get_status() );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->handle( $read )->get_status() );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		self::assertSame( 200, $controller->handle( $read )->get_status() );
		$put = self::request( 'feature-preferences', 'PUT', array( 'expectedRevision' => str_repeat( 'a', 64 ),
			'changes' => array( array( 'featureId' => 'feature_1', 'enabled' => false ) ) ) );
		self::assertSame( 200, $controller->handle( $put )->get_status() );
		self::assertSame( 'https://api.example.test/v1/merchant/feature-preferences', $sent[1][0] );
		self::assertSame( 'PUT', $sent[1][1]['method'] );
		self::assertSame( 'Bearer ' . self::record()['credential'], $sent[1][1]['headers']['Authorization'] );
		self::assertSame( 0, $sent[1][1]['redirection'] );
		self::assertArrayNotHasKey( 'shopId', json_decode( $sent[1][1]['body'], true ) );
	}
	public function test_rejects_browser_identity_malformed_or_disclosing_responses(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) {
			$calls++;
			return self::response( 200, self::feature() );
		} );
		foreach ( array(
			self::request( 'feature-preferences', 'GET', null, array(), array( 'shopId' => 'foreign' ) ),
			self::request( 'merchant-knowledge/sources', 'POST', array( 'name' => 'FAQ', 'purposeKey' => 'FAQ',
				'dataFormatKey' => 'WEB_PAGE', 'url' => 'http://internal/' ) ),
			self::request( 'feature-preferences', 'PUT', array( 'shopId' => 'different', 'expectedRevision' => str_repeat( 'a', 64 ), 'changes' => array() ) ),
			self::request( 'merchant-knowledge/order', 'PUT', array( 'sourceIds' => array( 'one', 'one' ) ) ),
		) as $invalid ) self::assertSame( 400, $controller->handle( $invalid )->get_status() );
		self::assertSame( 0, $calls );
		$unsafe = $this->controller( static fn() => self::response( 200, array_merge( self::feature(), array( 'credential' => 'secret' ) ) ) );
		self::assertSame( 502, $unsafe->handle( self::request( 'feature-preferences' ) )->get_status() );
		self::assertFalse( MerchantKnowledgeContracts::commandResponse( array( 'knowledge' => array( 'credential' => 'secret' ) ) ) );
	}
	public function test_revocation_site_change_and_credential_rotation_fail_closed(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) { $calls++; return self::response( 200, self::feature() ); } );
		$GLOBALS['moda_interact_home_url'] = 'http://changed.local:8080';
		self::assertSame( 409, $controller->handle( self::request( 'feature-preferences' ) )->get_status() );
		self::assertSame( 0, $calls );
		$GLOBALS['moda_interact_home_url'] = self::record()['canonicalSiteUrl'];
		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 401, $controller->handle( self::request( 'feature-preferences' ) )->get_status() );
		$rotated = $this->controller( static function () {
			delete_option( InstallationStore::OPTION_NAME );
			return self::response( 200, self::feature() );
		} );
		self::assertSame( 409, $rotated->handle( self::request( 'feature-preferences' ) )->get_status() );
	}
	public function test_hosted_error_does_not_leak_remote_content(): void {
		$controller = $this->controller( static fn() => self::response( 409, array( 'error' => 'merchant_knowledge_conflict', 'token' => 'secret' ) ) );
		$result = $controller->handle( self::request( 'merchant-knowledge/sources/abc', 'DELETE', array( 'expectedGeneration' => 1 ) ) );
		self::assertSame( 409, $result->get_status() );
		self::assertSame( array( 'status' => 'CONFLICT' ), $result->get_data() );
	}
	private static function knowledge(): array {
		return array( 'schemaVersion' => 1, 'state' => 'MERCHANT_DISABLED', 'planEntitled' => true,
			'merchantEnabled' => false, 'effectiveEnabled' => false, 'maxKnowledgeSources' => 10,
			'maxContentUnitsPerSource' => 100, 'maxUploadBytes' => 1024, 'configuredCount' => 0,
			'planEligibleSourceCount' => 0, 'defaultLanguageTag' => 'en',
			'supportedLanguageTags' => array( 'en' ), 'catalogue' => array(), 'sources' => array(),
			'nextPosition' => null );
	}

	public function test_knowledge_and_source_lifecycle_routes_broker_exact_hosted_contracts(): void {
		$seen = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$seen ) {
			$seen[] = array( $url, $args );
			if ( str_ends_with( $url, '/uploads/file_1/reprocess' ) ) {
				return self::response( 200, array( 'schemaVersion' => 1, 'sourceId' => 'file_1',
					'revisionId' => 'rev_1', 'generation' => 2, 'status' => 'ACCEPTED' ) );
			}
			if ( str_ends_with( $url, '/uploads/file_1' ) ) {
				return self::response( 200, array( 'schemaVersion' => 1, 'sourceId' => 'file_1', 'updated' => true ) );
			}
			return self::response( str_ends_with( $url, '/sources' ) ? 201 : 200,
				array( 'knowledge' => self::knowledge(), 'created' => str_ends_with( $url, '/sources' ),
					'sourceId' => 'source_1' ) );
		} );
		$requests = array(
			array( 'merchant-knowledge/sources', 'POST', array( 'name' => 'FAQ', 'purposeKey' => 'FAQ',
				'dataFormatKey' => 'WEB_PAGE', 'url' => 'https://example.org/help' ),
				'/sources', 201 ),
			array( 'merchant-knowledge/sources/source_1', 'PATCH', array( 'expectedGeneration' => 1,
				'name' => 'New FAQ' ), '/sources/source_1', 200 ),
			array( 'merchant-knowledge/sources/source_1/refresh', 'POST', array( 'expectedGeneration' => 1 ),
				'/sources/source_1/refresh', 200 ),
			array( 'merchant-knowledge/order', 'PUT', array( 'sourceIds' => array( 'source_1' ) ), '/order', 200 ),
			array( 'merchant-knowledge/sources/source_1', 'DELETE', array( 'expectedGeneration' => 1 ),
				'/sources/source_1', 200 ),
			array( 'merchant-knowledge/uploads/file_1', 'PATCH', array( 'name' => 'Updated FAQ', 'languageTag' => 'en' ),
				'/uploads/file_1', 200 ),
			array( 'merchant-knowledge/uploads/file_1/reprocess', 'POST', null,
				'/uploads/file_1/reprocess', 200 ),
		);
		foreach ( $requests as $case ) {
			list( $route, $method, $payload, $suffix, $status ) = $case;
			$result = $controller->handle( self::request( $route, $method, $payload ) );
			self::assertSame( $status, $result->get_status(), $route );
			self::assertStringContainsString( 'no-store', $result->get_headers()['Cache-Control'] );
			$remote = $seen[ count( $seen ) - 1 ];
			self::assertSame( 'https://api.example.test/v1/merchant/merchant-knowledge' . $suffix, $remote[0] );
			self::assertSame( $method, $remote[1]['method'] );
			self::assertSame( null === $payload ? null : $payload,
				isset( $remote[1]['body'] ) ? json_decode( $remote[1]['body'], true ) : null );
			self::assertSame( 0, $remote[1]['redirection'] );
		}
		self::assertCount( count( $requests ), $seen );
	}

	public function test_knowledge_proxy_uses_bounded_transport_budget_without_changing_other_routes(): void {
		$requests = array();
		$client = new ModaApiClient(
			ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ),
			static function ( string $url, array $args ) use ( &$requests ): array {
				$requests[] = array( 'url' => $url, 'args' => $args );
				if ( str_ends_with( $url, '/feature-preferences' ) ) {
					return self::response( 200, self::feature() );
				}
				if ( str_ends_with( $url, '/sources' ) ) {
					// The hosted create and post-commit projection can exceed five seconds.
					return self::response( 201, array( 'created' => true, 'sourceId' => 'source_1',
						'knowledge' => self::knowledge() ) );
				}
				return self::response( 200, self::knowledge() );
			}
		);
		$connection = self::record();
		$client->merchantKnowledgeExchange( $connection, '/v1/merchant/merchant-knowledge', 'GET' );
		$result = $client->merchantKnowledgeExchange( $connection, '/v1/merchant/merchant-knowledge/sources',
			'POST', array( 'name' => 'FAQ', 'purposeKey' => 'FAQ', 'dataFormatKey' => 'WEB_PAGE',
				'url' => 'https://example.org/help' ) );
		self::assertTrue( $result['created'] );
		$client->merchantKnowledgeExchange( $connection, '/v1/merchant/feature-preferences', 'GET' );
		self::assertSame( array( 20, 20, 5 ), array_map(
			static fn( array $item ): int => $item['args']['timeout'], $requests
		) );
		foreach ( $requests as $item ) {
			self::assertSame( 0, $item['args']['redirection'] );
			self::assertSame( array(), $item['args']['cookies'] );
			self::assertTrue( $item['args']['sslverify'] );
			self::assertStringStartsWith( 'Bearer ', $item['args']['headers']['Authorization'] );
		}
	}

	public function test_knowledge_projection_supports_cursor_and_rejects_unexpected_fields(): void {
		$seen = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$seen ) {
			$seen[] = $url;
			return self::response( 200, self::knowledge() );
		} );
		$response = $controller->handle( self::request( 'merchant-knowledge', 'GET', null, array(),
			array( '_locale' => 'user', 'afterPosition' => '7' ) ) );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( 'https://api.example.test/v1/merchant/merchant-knowledge?afterPosition=7', $seen[0] );
		self::assertStringContainsString( 'no-store', $response->get_headers()['Cache-Control'] );
		$response = $controller->handle( self::request( 'merchant-knowledge', 'GET', null, array(),
			array( 'afterPosition' => 'not_a_number' ) ) );
		self::assertSame( 400, $response->get_status() );
		self::assertCount( 1, $seen );
		$invalid = $this->controller( static fn() => self::response( 200,
			array_merge( self::knowledge(), array( 'signedUrl' => 'https://secret.test' ) ) ) );
		self::assertSame( 502, $invalid->handle( self::request( 'merchant-knowledge' ) )->get_status() );
	}

}
