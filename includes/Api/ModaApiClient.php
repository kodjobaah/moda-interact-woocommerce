<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Security\Base64Url;

final class ModaApiClient {
	private $transport;

	public function __construct(
		private readonly ModaApiConfiguration $configuration,
		?callable $transport = null
	) {
		$this->transport = $transport ?? static fn( string $url, array $args ) => wp_remote_request( $url, $args );
	}

	public function connect( string $site_url, string $attempt_id, string $bootstrap_secret ): array {
		$body = wp_json_encode(
			array(
				'siteUrl'        => $site_url,
				'attemptId'      => $attempt_id,
				'bootstrapSecret'=> $bootstrap_secret,
			)
		);
		if ( ! is_string( $body ) || strlen( $body ) > 8192 ) {
			throw new ModaApiClientException( 'remote_unavailable' );
		}

		$response = $this->request(
			'/v1/woocommerce/installations/connect',
			'POST',
			array( 'Content-Type' => 'application/json' ),
			$body
		);
		$status   = wp_remote_retrieve_response_code( $response );
		$payload  = $this->jsonBody( $response );
		$expected_status = array( 201 => 'CREATED', 200 => 'RECONNECTED' );
		if ( ! isset( $expected_status[ $status ] ) || ! self::hasExactKeys( $payload, array( 'installationId', 'shopId', 'canonicalSiteUrl', 'credential', 'credentialVersion', 'connection' ) ) ) {
			throw new ModaApiClientException( 400 <= $status && $status < 500 ? 'remote_rejected' : 'remote_unavailable', $status );
		}
		if (
			! is_string( $payload['installationId'] ) || '' === $payload['installationId'] ||
			! is_string( $payload['shopId'] ) || '' === $payload['shopId'] ||
			$payload['canonicalSiteUrl'] !== $site_url ||
			! is_string( $payload['credential'] ) || null === Base64Url::decode( $payload['credential'], 32 ) ||
			! is_int( $payload['credentialVersion'] ) || $payload['credentialVersion'] < 1 ||
			$payload['connection'] !== $expected_status[ $status ]
		) {
			throw new ModaApiClientException( 'remote_unavailable', $status );
		}
		return $payload;
	}

	public function probe( array $connection ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ) {
			throw new ModaApiClientException( 'local_state_invalid' );
		}
		$response = $this->request(
			'/v1/woocommerce/installation',
			'GET',
			array(
				'X-Moda-Installation-Id' => $connection['installationId'],
				'Authorization'         => 'Bearer ' . $connection['credential'],
			)
		);
		$status = wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) {
			throw new ModaApiClientException( 'unauthorized', $status );
		}
		$payload = $this->jsonBody( $response );
		if ( 200 !== $status || ! self::hasExactKeys( $payload, array( 'installationId', 'shopId', 'canonicalSiteUrl', 'credentialVersion' ) ) ) {
			throw new ModaApiClientException( 'remote_unavailable', $status );
		}
		if (
			$payload['installationId'] !== $connection['installationId'] ||
			$payload['shopId'] !== $connection['shopId'] ||
			$payload['canonicalSiteUrl'] !== $connection['canonicalSiteUrl'] ||
			$payload['credentialVersion'] !== $connection['credentialVersion']
		) {
			throw new ModaApiClientException( 'remote_unavailable', $status );
		}
		return $payload;
	}

	private function request( string $path, string $method, array $headers, ?string $body = null ): mixed {
		$url = $this->configuration->base_url . $path;
		$args = array(
			'method'              => $method,
			'timeout'             => 5,
			'redirection'         => 0,
			'blocking'            => true,
			'headers'             => array_merge( array( 'Accept' => 'application/json' ), $headers ),
			'cookies'             => array(),
			'sslverify'           => true,
			'reject_unsafe_urls'  => ModaApiConfiguration::MODE_PUBLIC === $this->configuration->mode,
			'limit_response_size' => 8193,
		);
		if ( null !== $this->configuration->ca_bundle ) {
			$args['sslcertificates'] = $this->configuration->ca_bundle;
		}
		if ( null !== $body ) {
			$args['body'] = $body;
		}
		$response = ( $this->transport )( $url, $args );
		if ( ( function_exists( 'is_wp_error' ) && is_wp_error( $response ) ) || ! is_array( $response ) ) {
			throw new ModaApiClientException( 'remote_unavailable' );
		}
		return $response;
	}

	private function jsonBody( mixed $response ): array {
		$content_type = (string) wp_remote_retrieve_header( $response, 'content-type' );
		$body         = wp_remote_retrieve_body( $response );
		if ( ! preg_match( '#^application/json(?:\s*;|$)#i', trim( $content_type ) ) || ! is_string( $body ) || strlen( $body ) > 8192 ) {
			throw new ModaApiClientException( 'remote_unavailable' );
		}
		$payload = json_decode( $body, true );
		return is_array( $payload ) && ! array_is_list( $payload ) ? $payload : array();
	}

	private static function hasExactKeys( array $payload, array $expected ): bool {
		$actual = array_keys( $payload );
		sort( $actual );
		sort( $expected );
		return $actual === $expected;
	}
}

final class ModaApiClientException extends \RuntimeException {
	public function __construct( string $reason, public readonly ?int $http_status = null ) {
		parent::__construct( $reason );
	}
}