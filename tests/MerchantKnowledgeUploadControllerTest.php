<?php

require_once __DIR__ . '/fixtures/MerchantKnowledgeTestBase.php';

use ModaInteract\WooCommerce\Connection\InstallationStore;

final class MerchantKnowledgeUploadControllerTest extends MerchantKnowledgeTestBase {

	private static function intentRequest(): array {
		return array( 'idempotencyKey' => '12345678-1234-4123-8123-123456789abc', 'purposeKey' => 'FAQ',
			'dataFormatKey' => 'CSV', 'originalFileName' => 'faq.csv', 'contentType' => 'text/csv',
			'sizeBytes' => 3, 'sha256' => hash( 'sha256', 'a,b' ) );
	}
	private static function finalizeRequest(): array {
		return array( 'assetId' => '12345678-1234-5123-a123-123456789abc', 'purposeKey' => 'FAQ',
			'name' => 'FAQ', 'languageTag' => 'en', 'contentType' => 'text/csv',
			'sizeBytes' => 3, 'sha256' => hash( 'sha256', 'a,b' ) );
	}
	private static function intentResponse( array $request ): array {
		$asset = self::finalizeRequest()['assetId'];
		$path = '/merchant-bucket/merchant-knowledge/development/woocommerce/shop_456/' . $asset .
			'/source.' . strtolower( $request['dataFormatKey'] );
		$query = http_build_query( array(
			'X-Amz-Algorithm' => 'AWS4-HMAC-SHA256',
			'X-Amz-Credential' => 'TESTKEY/20261018/auto/s3/aws4_request',
			'X-Amz-Date' => gmdate( 'Ymd\THis\Z' ),
			'X-Amz-Expires' => '300',
			'X-Amz-SignedHeaders' => 'content-type;host;if-none-match;x-amz-meta-sha256',
			'X-Amz-Signature' => str_repeat( 'a', 64 ),
			'x-id' => 'PutObject',
		), '', '&', PHP_QUERY_RFC3986 );
		return array( 'schemaVersion' => 1, 'assetId' => $asset,
			'uploadUrl' => 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com' . $path . '?' . $query,
			'expiresAt' => gmdate( 'Y-m-d\TH:i:s\Z', time() + 300 ), 'maxUploadBytes' => 1024,
			'requiredHeaders' => array( 'Content-Type' => $request['contentType'],
				'If-None-Match' => '*', 'x-amz-meta-sha256' => $request['sha256'] ) );
	}
	private static function accepted(): array {
		return array( 'schemaVersion' => 1, 'sourceId' => 'source_1', 'revisionId' => 'revision_1',
			'generation' => 1, 'status' => 'ACCEPTED' );
	}

	public function test_browser_intent_is_privileged_metadata_only_and_signed_capability_is_no_store(): void {
		$metadata = self::intentRequest();
		$intent = self::intentResponse( $metadata );
		putenv( 'MODA_MERCHANT_KNOWLEDGE_R2_ENDPOINT' );
		putenv( 'MODA_MERCHANT_KNOWLEDGE_R2_BUCKET' );
		$requests = array();
		$controller = $this->controller( static function ( $url, $args ) use ( $intent, &$requests ) {
			$requests[] = array( $url, $args );
			return self::response( 200, $intent );
		} );
		$controller->registerRoutes();
		self::assertArrayHasKey( 'moda-interact/v1/merchant/merchant-knowledge/upload-intents', $GLOBALS['moda_interact_registered_rest_routes'] );
		self::assertArrayHasKey( 'moda-interact/v1/merchant/merchant-knowledge/upload-finalize', $GLOBALS['moda_interact_registered_rest_routes'] );
		self::assertArrayNotHasKey( 'moda-interact/v1/merchant/merchant-knowledge/upload', $GLOBALS['moda_interact_registered_rest_routes'] );
		$response = $controller->handle( self::request( 'merchant-knowledge/upload-intents', 'POST', $metadata ) );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( $intent, $response->get_data() );
		self::assertStringContainsString( 'no-store', $response->get_headers()['Cache-Control'] );
		self::assertSame( 'no-cache', $response->get_headers()['Pragma'] );
		self::assertCount( 1, $requests );
		self::assertSame( 'https://api.example.test/v1/merchant/merchant-knowledge/upload-intents', $requests[0][0] );
		self::assertSame( $metadata, json_decode( $requests[0][1]['body'], true ) );
		self::assertSame( 'Bearer ' . self::record()['credential'], $requests[0][1]['headers']['Authorization'] );
		self::assertSame( 0, $requests[0][1]['redirection'] );
		self::assertSame( 20, $requests[0][1]['timeout'] );
		self::assertArrayNotHasKey( 'uploadUrl', json_decode( $requests[0][1]['body'], true ) );
		// WordPress must not require the merchant to configure an R2 endpoint or bucket.
		self::assertSame( $intent['uploadUrl'], $response->get_data()['uploadUrl'] );
	}

	public function test_intent_passthrough_does_not_require_wordpress_r2_configuration_or_a_specific_object_key(): void {
		putenv( 'MODA_MERCHANT_KNOWLEDGE_R2_ENDPOINT' );
		putenv( 'MODA_MERCHANT_KNOWLEDGE_R2_BUCKET' );
		$metadata = self::intentRequest();
		$intent = self::intentResponse( $metadata );
		$intent['uploadUrl'] = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com/opaque-new-path?signature=example';
		$intent['requiredHeaders'] = array( 'Content-Type' => 'text/csv' );
		$controller = $this->controller( static fn() => self::response( 200, $intent ) );
		$response = $controller->handle( self::request( 'merchant-knowledge/upload-intents', 'POST', $metadata ) );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( $intent, $response->get_data() );
	}

	public function test_finalize_brokers_only_metadata_after_rechecking_site_and_credentials(): void {
		$payload = self::finalizeRequest();
		$requests = array();
		$controller = $this->controller( static function ( $url, $args ) use ( &$requests ) {
			$requests[] = array( $url, $args );
			return self::response( 200, self::accepted() );
		} );
		$response = $controller->handle( self::request( 'merchant-knowledge/upload-finalize', 'POST', $payload ) );
		self::assertSame( 200, $response->get_status() );
		self::assertSame( self::accepted(), $response->get_data() );
		self::assertStringContainsString( 'no-store', $response->get_headers()['Cache-Control'] );
		self::assertCount( 1, $requests );
		self::assertSame( 'https://api.example.test/v1/merchant/merchant-knowledge/upload-finalize', $requests[0][0] );
		self::assertSame( $payload, json_decode( $requests[0][1]['body'], true ) );
		self::assertArrayNotHasKey( 'shopId', json_decode( $requests[0][1]['body'], true ) );
		self::assertArrayNotHasKey( 'uploadUrl', json_decode( $requests[0][1]['body'], true ) );
		self::assertArrayNotHasKey( 'file', json_decode( $requests[0][1]['body'], true ) );
	}

	public function test_metadata_upload_auth_nonce_revocation_and_stale_identity_fail_closed(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) {
			$calls++;
			return self::response( 200, self::intentResponse( self::intentRequest() ) );
		} );
		$intent = self::request( 'merchant-knowledge/upload-intents', 'POST', self::intentRequest() );
		$finalize = self::request( 'merchant-knowledge/upload-finalize', 'POST', self::finalizeRequest() );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->handle( $intent )->get_status() );
		self::assertSame( 403, $controller->handle( $finalize )->get_status() );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->handle( $intent )->get_status() );
		self::assertSame( 403, $controller->handle( $finalize )->get_status() );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_interact_home_url'] = 'http://another-site.local:8080';
		self::assertSame( 409, $controller->handle( $intent )->get_status() );
		self::assertSame( 409, $controller->handle( $finalize )->get_status() );
		$GLOBALS['moda_interact_home_url'] = self::record()['canonicalSiteUrl'];
		delete_option( InstallationStore::OPTION_NAME );
		self::assertSame( 401, $controller->handle( $intent )->get_status() );
		self::assertSame( 401, $controller->handle( $finalize )->get_status() );
		self::assertSame( 0, $calls );
	}

	public function test_rotation_during_metadata_exchange_drops_capability_without_disclosure(): void {
		$controller = $this->controller( static function () {
			delete_option( InstallationStore::OPTION_NAME );
			return self::response( 200, self::intentResponse( self::intentRequest() ) );
		} );
		$response = $controller->handle( self::request( 'merchant-knowledge/upload-intents', 'POST', self::intentRequest() ) );
		self::assertSame( 409, $response->get_status() );
		self::assertSame( array( 'status' => 'RECONNECT_REQUIRED' ), $response->get_data() );
		self::assertStringNotContainsString( 'X-Amz', wp_json_encode( $response->get_data() ) );
		self::assertStringContainsString( 'no-store', $response->get_headers()['Cache-Control'] );
		$controller = $this->controller( static function () {
			$GLOBALS['moda_interact_home_url'] = 'http://changed-while-finalizing.local:8080';
			return self::response( 200, self::accepted() );
		} );
		self::assertSame( 409, $controller->handle( self::request( 'merchant-knowledge/upload-finalize', 'POST', self::finalizeRequest() ) )->get_status() );
	}

	public function test_multipart_binary_and_obsolete_upload_route_are_not_accepted_or_forwarded(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) {
			$calls++;
			throw new \LogicException( 'Unexpected outbound HTTP' );
		} );
		foreach ( array( 'merchant-knowledge/upload-intents', 'merchant-knowledge/upload-finalize' ) as $route ) {
			$metadata = str_ends_with( $route, 'upload-intents' ) ? self::intentRequest() : self::finalizeRequest();
			$multipart = self::request( $route, 'POST', null, array( 'file' => 'binary' ) );
			$multipart->set_header( 'Content-Type', 'multipart/form-data; boundary=fixture' );
			self::assertSame( 400, $controller->handle( $multipart )->get_status() );
			$files = self::request( $route, 'POST', $metadata );
			$files->set_file_params( array( 'file' => array( 'tmp_name' => '/tmp/untrusted' ) ) );
			self::assertSame( 400, $controller->handle( $files )->get_status() );
			$body = self::request( $route, 'POST', $metadata, array( 'file' => 'binary' ) );
			self::assertSame( 400, $controller->handle( $body )->get_status() );
			$extra = self::request( $route, 'POST', $metadata + array( 'file' => 'untrusted bytes' ) );
			self::assertSame( 400, $controller->handle( $extra )->get_status() );
		}
		self::assertSame( 400, $controller->handle( self::request( 'merchant-knowledge/upload', 'POST', self::intentRequest() ) )->get_status() );
		self::assertSame( 0, $calls );
	}

	public function test_intent_rejects_invalid_mime_size_metadata_and_untrusted_identity(): void {
		$calls = 0;
		$controller = $this->controller( static function () use ( &$calls ) {
			$calls++;
			throw new \LogicException( 'Unexpected outbound HTTP' );
		} );
		$valid = self::intentRequest();
		$cases = array(
			array( 'originalFileName' => '../faq.csv' ), array( 'originalFileName' => 'faq.xlsx' ),
			array( 'contentType' => 'image/png' ), array( 'contentType' => 'text/csv; charset=utf-8' ),
			array( 'sizeBytes' => 0 ), array( 'sizeBytes' => 250000000 ), array( 'sha256' => str_repeat( 'B', 64 ) ),
			array( 'idempotencyKey' => 'wrong' ), array( 'shopId' => 'foreign' ),
			array( 'uploadUrl' => 'https://example.com/' ), array( 'dataFormatKey' => 'WEB_PAGE' ),
		);
		foreach ( $cases as $case ) {
			$response = $controller->handle( self::request( 'merchant-knowledge/upload-intents', 'POST', array_replace( $valid, $case ) ) );
			self::assertSame( 400, $response->get_status(), json_encode( array_keys( $case ) ) );
		}
		self::assertSame( 0, $calls );
		$final = self::finalizeRequest();
		foreach ( array( array( 'sourceId' => 'bad/slash' ), array( 'contentType' => 'application/octet-stream' ),
			array( 'sizeBytes' => -1 ), array( 'shopId' => 'another_shop' ), array( 'uploadUrl' => 'secret' ),
			array( 'sha256' => str_repeat( 'B', 64 ) ) ) as $case ) {
			self::assertSame( 400, $controller->handle( self::request( 'merchant-knowledge/upload-finalize', 'POST', array_replace( $final, $case ) ) )->get_status() );
		}
		self::assertSame( 0, $calls );
	}

	public function test_upload_intent_diagnostic_trace_records_safe_stages_only(): void {
		$metadata = self::intentRequest();
		$intent = self::intentResponse( $metadata );
		$log_path = tempnam( sys_get_temp_dir(), 'moda-upload-trace-' );
		self::assertNotFalse( $log_path );
		$previous_log = ini_get( 'error_log' );
		$previous_setting = getenv( 'MODA_INTERACT_WOO_UPLOAD_TRACE' );
		try {
			putenv( 'MODA_INTERACT_WOO_UPLOAD_TRACE=1' );
			ini_set( 'error_log', $log_path );
			$controller = $this->controller( static fn() => self::response( 200, $intent ) );
			self::assertSame( 200, $controller->handle( self::request( 'merchant-knowledge/upload-intents', 'POST', $metadata ) )->get_status() );
			$invalid = $this->controller( static fn() => self::response( 200, $intent + array( 'credential' => 'must-not-leak' ) ) );
			self::assertSame( 502, $invalid->handle( self::request( 'merchant-knowledge/upload-intents', 'POST', $metadata ) )->get_status() );
			$log = (string) file_get_contents( $log_path );
			foreach ( array( 'request_received', 'upstream_request_started', 'upstream_response_decoded',
				'intent_response_accepted', 'response_prepared', 'intent_response_invalid' ) as $stage ) {
				self::assertStringContainsString( '"stage":"' . $stage . '"', $log );
			}
			self::assertStringContainsString( '"httpStatus":502', $log );
			self::assertStringContainsString( '"apiEndpoint":"https:\/\/api.example.test\/v1\/merchant\/merchant-knowledge\/upload-intents"', $log );
			self::assertStringNotContainsString( $intent['uploadUrl'], $log );
			self::assertStringNotContainsString( self::record()['credential'], $log );
			self::assertStringNotContainsString( str_repeat( 'a', 64 ), $log );
			self::assertStringNotContainsString( 'TESTKEY', $log );
			self::assertStringNotContainsString( 'must-not-leak', $log );
		} finally {
			false === $previous_setting ? putenv( 'MODA_INTERACT_WOO_UPLOAD_TRACE' ) : putenv( 'MODA_INTERACT_WOO_UPLOAD_TRACE=' . $previous_setting );
			false === $previous_log ? ini_restore( 'error_log' ) : ini_set( 'error_log', $previous_log );
			@unlink( $log_path );
		}
	}

	public function test_malformed_upstream_response_and_upstream_errors_never_reflect_signed_url(): void {
		$metadata = self::intentRequest();
		$intent = self::intentResponse( $metadata );
		$controller = $this->controller( static fn() => self::response( 200, $intent + array( 'secret' => 'should-not-leak' ) ) );
		self::assertSame( 502, $controller->handle( self::request( 'merchant-knowledge/upload-intents', 'POST', $metadata ) )->get_status() );
		$controller = $this->controller( static fn() => self::response( 409, array( 'error' => 'knowledge_upload_expired',
			'uploadUrl' => 'X-Amz-Signature=SECRET' ) ) );
		$response = $controller->handle( self::request( 'merchant-knowledge/upload-finalize', 'POST', self::finalizeRequest() ) );
		self::assertSame( 409, $response->get_status() );
		self::assertSame( array( 'status' => 'CONFLICT' ), $response->get_data() );
		self::assertStringNotContainsString( 'SECRET', wp_json_encode( $response->get_data() ) );
		$controller = $this->controller( static fn() => self::response( 503, array( 'error' => 'knowledge_upload_unavailable',
			'uploadUrl' => 'X-Amz-Signature=SECRET' ) ) );
		$response = $controller->handle( self::request( 'merchant-knowledge/upload-intents', 'POST', $metadata ) );
		self::assertSame( 503, $response->get_status() );
		self::assertSame( array( 'status' => 'REMOTE_UNAVAILABLE' ), $response->get_data() );
	}
}
