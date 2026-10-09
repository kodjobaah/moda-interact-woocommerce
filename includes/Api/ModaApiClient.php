<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Security\Base64Url;

final class ModaApiClient {
	private const CONNECT_TIMEOUT_SECONDS = 30;
	/** Publication may take longer than a read; only category POST receives this budget. */
	private const CATEGORY_SELECTION_TIMEOUT_SECONDS = 30;
	private const DEFAULT_TIMEOUT_SECONDS = 5;

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
			$body,
			self::CONNECT_TIMEOUT_SECONDS
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

	public function merchantBootstrap( array $connection ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ) {
			throw new ModaApiClientException( 'local_state_invalid' );
		}

		$response = $this->request(
			'/v1/merchant/bootstrap',
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
		if ( 200 !== $status ) {
			throw new ModaApiClientException( 'remote_unavailable', $status );
		}

		try {
			$payload = $this->jsonBody( $response );
		} catch ( ModaApiClientException $error ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}

		if ( ! self::isMerchantBootstrap( $payload ) || $payload['shop']['id'] !== $connection['shopId'] ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}

		return $payload;
	}

	/** Effective recovery policy projection for the current authenticated installation. */
	public function merchantRecoverySummary( array $connection ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ) {
			throw new ModaApiClientException( 'local_state_invalid' );
		}
		$response = $this->request(
			'/v1/merchant/recovery-summary',
			'GET',
			self::installationHeaders( $connection )
		);
		$status = wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) {
			throw new ModaApiClientException( 'unauthorized', $status );
		}
		if ( 409 === $status ) {
			throw new ModaApiClientException( 'tenant_conflict', $status );
		}
		if ( 200 !== $status ) {
			throw new ModaApiClientException( 'remote_unavailable', $status );
		}
		try {
			$payload = $this->jsonBody( $response );
		} catch ( ModaApiClientException $error ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		if ( ! RecoverySummaryResponseValidator::isValid( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		return $payload;
	}

	public function billingPresentation( array $connection ): array {
		$payload = $this->billingRequest( $connection, '/v1/billing', 'GET' );
		if ( ! BillingResponseValidator::isPresentation( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', 200 );
		}
		return $payload;
	}

	public function billingPlans( array $connection, ?string $locale = null ): array {
		$path = '/v1/billing/plans';
		if ( null !== $locale && '' !== $locale ) {
			$path .= '?locale=' . rawurlencode( $locale );
		}
		$payload = $this->billingRequest( $connection, $path, 'GET' );
		if ( ! BillingResponseValidator::isPlanCatalogue( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', 200 );
		}
		return $payload;
	}

	public function createSubscription( array $connection, string $plan_id, string $action_id ): array {
		return $this->recurringCommand( $connection, '/v1/billing/subscription', 'POST', $plan_id, $action_id );
	}

	public function switchSubscription( array $connection, string $plan_id, string $action_id ): array {
		return $this->recurringCommand( $connection, '/v1/billing/subscription/switch', 'POST', $plan_id, $action_id );
	}

	public function cancelSubscription( array $connection, string $action_id ): array {
		$payload = $this->billingRequest( $connection, '/v1/billing/subscription', 'DELETE', null, $action_id );
		if ( ! BillingResponseValidator::isCancellation( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', 200 );
		}
		return array_intersect_key( $payload, array_flip( array( 'schemaVersion', 'operationId', 'state', 'confirmationUrl' ) ) );
	}

	private function recurringCommand( array $connection, string $path, string $method, string $plan_id, string $action_id ): array {
		$payload = $this->billingRequest( $connection, $path, $method, array( 'merchantPricingPlanId' => $plan_id ), $action_id );
		if ( ! BillingResponseValidator::isConfirmation( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', 200 );
		}
		return array_intersect_key( $payload, array_flip( array( 'schemaVersion', 'operationId', 'state', 'confirmationUrl' ) ) );
	}

	private function billingRequest( array $connection, string $path, string $method, ?array $payload = null, ?string $action_id = null ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ) {
			throw new ModaApiClientException( 'local_state_invalid' );
		}
		$headers = array(
			'X-Moda-Installation-Id' => $connection['installationId'],
			'Authorization' => 'Bearer ' . $connection['credential'],
		);
		$body = null;
		if ( null !== $payload ) {
			$body = wp_json_encode( $payload );
			if ( ! is_string( $body ) || strlen( $body ) > 8192 ) {
				throw new ModaApiClientException( 'remote_unavailable' );
			}
			$headers['Content-Type'] = 'application/json';
		}
		if ( null !== $action_id ) {
			$headers['Idempotency-Key'] = $action_id;
		}
		$response = $this->request( $path, $method, $headers, $body );
		$status = wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) {
			throw new ModaApiClientException( 'unauthorized', $status );
		}
		$expected = 'GET' === $method ? array( 200 ) : ( 'DELETE' === $method ? array( 200 ) : array( 200, 202 ) );
		if ( ! in_array( $status, $expected, true ) ) {
			throw new ModaApiClientException(
				400 <= $status && $status < 500 ? 'remote_rejected' : 'remote_unavailable',
				$status,
				self::billingErrorCode( $response )
			);
		}
		try {
			return $this->jsonBody( $response );
		} catch ( ModaApiClientException $error ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
	}

	/** API-004: context-only update; never modifies installation, billing or credentials. */
	public function putMerchantStoreContext( array $connection, array $snapshot ): void {
		if ( ! InstallationStore::isValidRecord( $connection ) ||
			! self::hasExactKeys( $snapshot, array( 'schemaVersion', 'storeLocale', 'languageTag', 'timeZone', 'countryCode' ) ) ||
			1 !== $snapshot['schemaVersion'] ) {
			throw new ModaApiClientException( 'local_state_invalid' );
		}
		$body = wp_json_encode( $snapshot );
		if ( ! is_string( $body ) || strlen( $body ) > 2048 ) {
			throw new ModaApiClientException( 'remote_rejected' );
		}
		$response = $this->request(
			'/v1/merchant/store-context',
			'PUT',
			array(
				'Content-Type'           => 'application/json',
				'X-Moda-Installation-Id' => $connection['installationId'],
				'Authorization'         => 'Bearer ' . $connection['credential'],
			),
			$body
		);
		$status = wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) {
			throw new ModaApiClientException( 'unauthorized', $status );
		}
		if ( 409 === $status ) {
			throw new ModaApiClientException( 'tenant_conflict', $status );
		}
		if ( 400 === $status || 413 === $status ) {
			throw new ModaApiClientException( 'remote_rejected', $status );
		}
		if ( 204 !== $status ) {
			throw new ModaApiClientException( 'remote_unavailable', $status );
		}
		if ( '' !== wp_remote_retrieve_body( $response ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
	}

	/** API-005: read the canonical localized catalogue for this installation only. */
	public function merchantStoreCategories( array $connection, string $locale ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ||
			! preg_match( '/^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{2,8})*$/D', $locale ) || strlen( $locale ) > 64 ) {
			throw new ModaApiClientException( 'local_state_invalid' );
		}
		$response = $this->request(
			'/v1/merchant/store-categories?locale=' . rawurlencode( $locale ),
			'GET',
			self::installationHeaders( $connection ),
			null,
			self::DEFAULT_TIMEOUT_SECONDS,
			2097153
		);
		$status = wp_remote_retrieve_response_code( $response );
		self::assertCategoryStatus( $status );
		if ( 200 !== $status ) {
			throw new ModaApiClientException( 'remote_unavailable', $status );
		}
		try {
			$payload = $this->jsonBody( $response, 2097152 );
		} catch ( ModaApiClientException $error ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		if ( ! StoreCategoryContracts::isRead( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		return $payload;
	}

	/** API-006: explicit generation-checked publication; no implicit category defaults. */
	public function selectMerchantStoreCategory( array $connection, array $selection ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ||
			! self::hasExactKeys( $selection, array( 'schemaVersion', 'categoryId', 'selectedMappingIds', 'expectedPendingSelectionGeneration' ) ) ||
			1 !== $selection['schemaVersion'] ||
			! self::categoryId( $selection['categoryId'] ) ||
			! is_array( $selection['selectedMappingIds'] ) || ! array_is_list( $selection['selectedMappingIds'] ) ||
			count( $selection['selectedMappingIds'] ) > 50 ||
			count( $selection['selectedMappingIds'] ) !== count( array_unique( $selection['selectedMappingIds'] ) ) ||
			! is_int( $selection['expectedPendingSelectionGeneration'] ) ||
			$selection['expectedPendingSelectionGeneration'] < 0 ||
			$selection['expectedPendingSelectionGeneration'] > 9007199254740990 ) {
			throw new ModaApiClientException( 'remote_rejected' );
		}
		foreach ( $selection['selectedMappingIds'] as $id ) {
			if ( ! self::categoryId( $id ) ) {
				throw new ModaApiClientException( 'remote_rejected' );
			}
		}
		$body = wp_json_encode( $selection );
		if ( ! is_string( $body ) || strlen( $body ) > 4096 ) {
			throw new ModaApiClientException( 'remote_rejected' );
		}
		$response = $this->request(
			'/v1/merchant/store-category',
			'POST',
			array_merge( array( 'Content-Type' => 'application/json' ), self::installationHeaders( $connection ) ),
			$body,
			self::CATEGORY_SELECTION_TIMEOUT_SECONDS
		);
		$status = wp_remote_retrieve_response_code( $response );
		self::assertCategoryStatus( $status );
		if ( 422 === $status ) {
			throw new ModaApiClientException( 'category_unavailable', $status );
		}
		if ( 400 === $status || 413 === $status ) {
			throw new ModaApiClientException( 'remote_rejected', $status );
		}
		if ( 200 !== $status ) {
			throw new ModaApiClientException( 'remote_unavailable', $status );
		}
		try {
			$payload = $this->jsonBody( $response );
		} catch ( ModaApiClientException $error ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		if ( ! StoreCategoryContracts::isSelection( $payload ) || $payload['activeCategoryId'] !== $selection['categoryId'] ||
			$payload['pendingSelectionGeneration'] <= $selection['expectedPendingSelectionGeneration'] ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		return $payload;
	}

	private static function categoryId( mixed $id ): bool {
		return is_string( $id ) && strlen( $id ) <= 128 && 1 === preg_match( '/^[A-Za-z0-9_-]+$/D', $id );
	}

	private static function installationHeaders( array $connection ): array {
		return array(
			'X-Moda-Installation-Id' => $connection['installationId'],
			'Authorization' => 'Bearer ' . $connection['credential'],
		);
	}

	private static function assertCategoryStatus( int $status ): void {
		if ( 401 === $status ) {
			throw new ModaApiClientException( 'unauthorized', $status );
		}
		if ( 409 === $status ) {
			throw new ModaApiClientException( 'tenant_conflict', $status );
		}
	}

	private function request( string $path, string $method, array $headers, ?string $body = null, int $timeout = self::DEFAULT_TIMEOUT_SECONDS, int $response_limit = 8193 ): mixed {
		$url = $this->configuration->base_url . $path;
		$args = array(
			'method'              => $method,
			'timeout'             => $timeout,
			'redirection'         => 0,
			'blocking'            => true,
			'headers'             => array_merge( array( 'Accept' => 'application/json' ), $headers ),
			'cookies'             => array(),
			'sslverify'           => true,
			'reject_unsafe_urls'  => ModaApiConfiguration::MODE_PUBLIC === $this->configuration->mode,
			'limit_response_size' => $response_limit,
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

	private function jsonBody( mixed $response, int $max_bytes = 8192 ): array {
		$content_type = (string) wp_remote_retrieve_header( $response, 'content-type' );
		$body         = wp_remote_retrieve_body( $response );
		if ( ! preg_match( '#^application/json(?:\s*;|$)#i', trim( $content_type ) ) || ! is_string( $body ) || strlen( $body ) > $max_bytes ) {
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

	private static function billingErrorCode( mixed $response ): ?string {
		try {
			$payload = self::decodeErrorBody( $response );
		} catch ( ModaApiClientException $error ) {
			return null;
		}
		$codes = array(
			'invalid_request', 'invalid_idempotency_key', 'request_too_large', 'unauthorized',
			'billing_provider_unavailable', 'billing_shop_invalid', 'billing_not_initialized',
			'billing_subscription_invalid', 'billing_plan_unavailable', 'billing_plan_materialization_invalid',
			'billing_plan_materialization_conflict', 'billing_operation_conflict', 'idempotency_conflict',
			'billing_operation_in_progress', 'billing_operation_failed', 'billing_provider_rejected',
			'billing_provider_outcome_unknown', 'free_plan_uses_cancellation', 'subscription_create_not_allowed',
			'subscription_switch_not_allowed', 'billing_catalogue_mapping_invalid', 'billing_plan_unchanged',
			'no_recurring_subscription', 'billing_integrity_invalid', 'billing_catalogue_invalid',
			'billing_catalogue_translation_unavailable', 'billing_locale_invalid', 'internal_error',
		);
		return isset( $payload['error'] ) && is_string( $payload['error'] ) && in_array( $payload['error'], $codes, true )
			? $payload['error']
			: null;
	}

	private static function decodeErrorBody( mixed $response ): array {
		$content_type = (string) wp_remote_retrieve_header( $response, 'content-type' );
		$body = wp_remote_retrieve_body( $response );
		if ( ! preg_match( '#^application/json(?:\s*;|$)#i', trim( $content_type ) ) || ! is_string( $body ) || strlen( $body ) > 8192 ) {
			throw new ModaApiClientException( 'remote_unavailable' );
		}
		$payload = json_decode( $body, true );
		if ( ! is_array( $payload ) || array_is_list( $payload ) || ! isset( $payload['error'] ) ) {
			throw new ModaApiClientException( 'remote_unavailable' );
		}
		return $payload;
	}

	private static function isMerchantBootstrap( array $payload ): bool {
		if (
			! self::hasExactKeys( $payload, array( 'schemaVersion', 'shop', 'internationalContext', 'storeProfile' ) ) ||
			1 !== $payload['schemaVersion'] ||
			! is_array( $payload['shop'] ) ||
			! self::hasExactKeys( $payload['shop'], array( 'id', 'platform', 'domain', 'onboardingCompleted', 'installedAt' ) ) ||
			! self::isBoundedString( $payload['shop']['id'], 128 ) ||
			'WOOCOMMERCE' !== $payload['shop']['platform'] ||
			! self::isBoundedString( $payload['shop']['domain'], 512 ) ||
			! is_bool( $payload['shop']['onboardingCompleted'] ) ||
			! self::isDateTime( $payload['shop']['installedAt'] ) ||
			! is_array( $payload['internationalContext'] ) ||
			! self::hasExactKeys( $payload['internationalContext'], array( 'storeLocale', 'languageTag', 'timeZone', 'countryCode' ) ) ||
			! self::isNullableBoundedString( $payload['internationalContext']['storeLocale'], 128 ) ||
			! self::isNullableBoundedString( $payload['internationalContext']['languageTag'], 64 ) ||
			! self::isNullableBoundedString( $payload['internationalContext']['timeZone'], 255 ) ||
			! self::isNullableBoundedString( $payload['internationalContext']['countryCode'], 2 ) ||
			! is_array( $payload['storeProfile'] ) ||
			! self::hasExactKeys( $payload['storeProfile'], array( 'activeCategory', 'pendingCategory', 'pendingSelectionGeneration', 'pendingSelectedAt' ) ) ||
			! is_int( $payload['storeProfile']['pendingSelectionGeneration'] ) ||
			$payload['storeProfile']['pendingSelectionGeneration'] < 0 ||
			! self::isNullableDateTime( $payload['storeProfile']['pendingSelectedAt'] )
		) {
			return false;
		}

		return self::isNullableCategory( $payload['storeProfile']['activeCategory'] ) &&
			self::isNullableCategory( $payload['storeProfile']['pendingCategory'] );
	}

	private static function isNullableCategory( mixed $category ): bool {
		return null === $category || (
			is_array( $category ) &&
			self::hasExactKeys( $category, array( 'id', 'slug', 'displayName' ) ) &&
			self::isBoundedString( $category['id'], 128 ) &&
			self::isBoundedString( $category['slug'], 128 ) &&
			self::isBoundedString( $category['displayName'], 255 )
		);
	}

	private static function isNullableBoundedString( mixed $value, int $maximum ): bool {
		return null === $value || self::isBoundedString( $value, $maximum );
	}

	private static function isBoundedString( mixed $value, int $maximum ): bool {
		if ( ! is_string( $value ) || '' === $value || false === preg_match_all( '/./us', $value, $matches ) ) {
			return false;
		}
		return count( $matches[0] ) <= $maximum;
	}

	private static function isNullableDateTime( mixed $value ): bool {
		return null === $value || self::isDateTime( $value );
	}

	private static function isDateTime( mixed $value ): bool {
		if ( ! is_string( $value ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $value ) ) {
			return false;
		}
		$parsed = date_parse( $value );
		return 0 === $parsed['error_count'] && 0 === $parsed['warning_count'];
	}
}

final class ModaApiClientException extends \RuntimeException {
	public function __construct( string $reason, public readonly ?int $http_status = null, public readonly ?string $remote_error = null ) {
		parent::__construct( $reason );
	}
}