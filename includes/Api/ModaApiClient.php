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

	/** Read or update the existing merchant recovery policy through API-002. */
	public function merchantRecoveryPolicy( array $connection, ?array $update = null ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ) {
			throw new ModaApiClientException( 'local_state_invalid' );
		}
		if ( null !== $update && ! RecoveryPolicyResponseValidator::isUpdate( $update ) ) {
			throw new ModaApiClientException( 'invalid_request' );
		}
		$body = null === $update ? null : wp_json_encode( $update );
		if ( null !== $update && ( ! is_string( $body ) || strlen( $body ) > 2048 ) ) {
			throw new ModaApiClientException( 'invalid_request' );
		}
		$headers = self::installationHeaders( $connection );
		if ( null !== $body ) $headers['Content-Type'] = 'application/json';
		$response = $this->request(
			'/v1/merchant/recovery-policy', null === $body ? 'GET' : 'PUT', $headers,
			$body, self::DEFAULT_TIMEOUT_SECONDS
		);
		$status = wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) throw new ModaApiClientException( 'unauthorized', $status );
		if ( 400 === $status || 413 === $status ) throw new ModaApiClientException( 'invalid_request', $status );
		if ( 409 === $status ) {
			try {
				$error = self::decodeErrorBody( $response )['error'] ?? null;
			} catch ( ModaApiClientException $exception ) {
				$error = null;
			}
			if ( 'recovery_policy_conflict' === $error ) throw new ModaApiClientException( 'policy_conflict', $status );
			if ( 'recovery_offer_unsupported' === $error ) throw new ModaApiClientException( 'offer_unsupported', $status );
			throw new ModaApiClientException( 'tenant_conflict', $status );
		}
		if ( 200 !== $status ) throw new ModaApiClientException( 'remote_unavailable', $status );
		try {
			$payload = $this->jsonBody( $response );
		} catch ( ModaApiClientException $exception ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		if ( ! RecoveryPolicyResponseValidator::isValid( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		return $payload;
	}

	/** Read-only, server-paginated recoveries for the authenticated Woo installation. */
	public function merchantRecoveries( array $connection, array $filters ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ) {
			throw new ModaApiClientException( 'local_state_invalid' );
		}
		$path = '/v1/merchant/recoveries?' . http_build_query( $filters, '', '&', PHP_QUERY_RFC3986 );
		$response = $this->request( $path, 'GET', self::installationHeaders( $connection ), null, self::DEFAULT_TIMEOUT_SECONDS, 131073 );
		$status = wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) throw new ModaApiClientException( 'unauthorized', $status );
		if ( 400 === $status ) throw new ModaApiClientException( 'invalid_request', $status );
		if ( 409 === $status ) throw new ModaApiClientException( 'tenant_conflict', $status );
		if ( 200 !== $status ) throw new ModaApiClientException( 'remote_unavailable', $status );
		try {
			$payload = $this->jsonBody( $response, 131072 );
		} catch ( ModaApiClientException $error ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		if ( ! RecoveryListResponseValidator::isValid( $payload ) ||
			( isset( $filters['pageSize'] ) && $payload['pageSize'] !== (int) $filters['pageSize'] ) ||
			( isset( $filters['page'] ) && $payload['page'] > (int) $filters['page'] ) ||
			( isset( $filters['from'] ) && $payload['from'] !== $filters['from'] ) ||
			( isset( $filters['to'] ) && $payload['to'] !== $filters['to'] ) ||
			( isset( $filters['q'] ) && $payload['q'] !== trim( $filters['q'] ) ) ||
			( isset( $filters['status'] ) && $payload['status'] !== $filters['status'] ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		return $payload;
	}


	/** API-013 detail reads: a single summary or one bounded cursor page. */
	public function merchantRecoveryDetail( array $connection, string $id, string $section = 'summary', array $query = array() ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ) throw new ModaApiClientException( 'local_state_invalid' );
		if ( ! preg_match( '/^[A-Za-z0-9_-]{1,191}$/D', $id ) ||
			! in_array( $section, array( 'summary', 'messages', 'related' ), true ) ) {
			throw new ModaApiClientException( 'invalid_request' );
		}
		$path = '/v1/merchant/recoveries/' . rawurlencode( $id );
		if ( 'summary' !== $section ) $path .= '/' . $section;
		if ( $query ) $path .= '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
		// 50 bounded Unicode messages can exceed 2 MiB; the JSON body is still capped at 8 MiB.
		$limit = 'messages' === $section ? 8388608 : ( 'related' === $section ? 16384 : 8192 );
		$response = $this->request( $path, 'GET', self::installationHeaders( $connection ), null, self::DEFAULT_TIMEOUT_SECONDS, $limit + 1 );
		$status = wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) throw new ModaApiClientException( 'unauthorized', $status );
		if ( 404 === $status ) throw new ModaApiClientException( 'not_found', $status );
		if ( 400 === $status ) throw new ModaApiClientException( 'invalid_request', $status );
		if ( 409 === $status ) throw new ModaApiClientException( 'tenant_conflict', $status );
		if ( 200 !== $status ) throw new ModaApiClientException( 'remote_unavailable', $status );
		try {
			$payload = $this->jsonBody( $response, $limit );
		} catch ( ModaApiClientException $error ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
		if ( ( 'summary' === $section && ( ! RecoveryDetailResponseValidator::isSummary( $payload ) || $payload['id'] !== $id ) ) ||
			( 'summary' !== $section && ! RecoveryDetailResponseValidator::isPage( $payload, $section ) ) ) {
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

	/** API-006 provider-scoped read; never submit a refund or return an unchecked provider URL. */
	public function billingPurchaseHistory( array $connection, string $filter, int $page, int $page_size ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ) throw new ModaApiClientException( 'local_state_invalid' );
		$path = '/v1/billing/recovery-credit-purchases?' . http_build_query( array(
			'filter' => $filter, 'page' => $page, 'pageSize' => $page_size,
		), '', '&', PHP_QUERY_RFC3986 );
		$response = $this->request( $path, 'GET', self::installationHeaders( $connection ), null, self::DEFAULT_TIMEOUT_SECONDS, 65537 );
		$status = wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) throw new ModaApiClientException( 'unauthorized', 401 );
		if ( 200 !== $status ) throw new ModaApiClientException( 409 === $status ? 'remote_rejected' : 'remote_unavailable', $status, self::billingErrorCode( $response ) );
		try {
			$payload = $this->jsonBody( $response, 65536 );
		} catch ( ModaApiClientException $error ) {
			throw new ModaApiClientException( 'remote_response_invalid', 200 );
		}
		if ( ! BillingPurchaseHistoryResponseValidator::history( $payload ) ||
			$payload['filter'] !== $filter || $payload['pageSize'] !== $page_size ) {
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
	public function purchaseRecoveryCredits( array $connection, string $usage_event_id, string $action_id ): array {
		$payload = $this->billingRequest( $connection, '/v1/billing/recovery-credit-purchases', 'POST', array( 'merchantPricingUsageEventId' => $usage_event_id ), $action_id );
		if ( ! BillingResponseValidator::isRecoveryCreditPurchase( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', 200 );
		}
		return array_intersect_key( $payload, array_flip( array( 'schemaVersion', 'purchaseId', 'operationId', 'state', 'confirmationUrl' ) ) );
	}

	/** WooCommerce read-only consent: the browser receives a bounded native approval URL only. */
	public function beginRestReadAuthorization( array $connection, ?string $admin_locale = null ): array {
		$payload = $this->restReadRequest( $connection, '/v1/woocommerce/read-authorizations', 'POST', 201, $admin_locale );
		if ( ! RestReadResponseValidator::start( $payload, $connection['canonicalSiteUrl'], $this->configuration->mode ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', 201 );
		}
		return $payload;
	}

	public function restReadAuthorizationStatus( array $connection ): array {
		$payload = $this->restReadRequest( $connection, '/v1/woocommerce/read-authorization', 'GET', 200 );
		if ( ! RestReadResponseValidator::status( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', 200 );
		}
		return $payload;
	}

	public function revokeRestReadAuthorization( array $connection ): array {
		$payload = $this->restReadRequest( $connection, '/v1/woocommerce/read-authorization', 'DELETE', 200 );
		if ( ! RestReadResponseValidator::revoked( $payload ) ) {
			throw new ModaApiClientException( 'remote_response_invalid', 200 );
		}
		return $payload;
	}

	private function restReadRequest( array $connection, string $path, string $method, int $expected_status, ?string $admin_locale = null ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ) {
			throw new ModaApiClientException( 'local_state_invalid' );
		}
		$headers = self::installationHeaders( $connection );
		if ( null !== $admin_locale ) {
			$headers['X-Moda-Admin-Locale'] = $admin_locale;
		}
		$response = $this->request( $path, $method, $headers );
		$status = wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) {
			throw new ModaApiClientException( 'unauthorized', $status );
		}
		if ( 409 === $status ) {
			throw new ModaApiClientException( 'tenant_conflict', $status );
		}
		if ( $expected_status !== $status ) {
			throw new ModaApiClientException( 'remote_unavailable', $status );
		}
		try {
			return $this->jsonBody( $response );
		} catch ( ModaApiClientException $error ) {
			throw new ModaApiClientException( 'remote_response_invalid', $status );
		}
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

	/** Woo merchant discount configuration, never a provider coupon REST proxy. */
	public function merchantDiscountOffers( array $connection, ?array $update = null ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ||
			( null !== $update && ! DiscountOffersContracts::update( $update ) ) ) {
			throw new ModaApiClientException( 'invalid_request' );
		}
		$body = null === $update ? null : wp_json_encode( $update );
		if ( null !== $update && ( ! is_string( $body ) || strlen( $body ) > 8192 ) ) {
			throw new ModaApiClientException( 'invalid_request' );
		}
		$headers = self::installationHeaders( $connection );
		if ( null !== $body ) $headers['Content-Type'] = 'application/json';
		$response = $this->request( '/v1/merchant/discount-offers',
			null === $body ? 'GET' : 'PUT', $headers, $body );
		$this->checkDiscountStatus( $response );
		$payload = $this->jsonBody( $response, 8192 );
		if ( ! DiscountOffersContracts::offers( $payload ) ) throw new ModaApiClientException( 'remote_response_invalid' );
		return $payload;
	}

	public function merchantDiscountCatalogue( array $connection, array $query ): array {
		if ( ! InstallationStore::isValidRecord( $connection ) ||
			array_diff( array_keys( $query ), array( 'limit', 'cursor', 'search' ) ) ||
			! isset( $query['limit'] ) || ! is_int( $query['limit'] ) || $query['limit'] < 1 || $query['limit'] > 25 ||
			( isset( $query['cursor'] ) && ! DiscountOffersContracts::id( $query['cursor'] ) ) ||
			( isset( $query['search'] ) && ( ! is_string( $query['search'] ) || strlen( $query['search'] ) > 80 ) ) ) {
			throw new ModaApiClientException( 'invalid_request' );
		}
		$path = '/v1/merchant/discount-catalogue?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
		$response = $this->request( $path, 'GET', self::installationHeaders( $connection ), null,
			self::DEFAULT_TIMEOUT_SECONDS, 262145 );
		$this->checkDiscountStatus( $response );
		$payload = $this->jsonBody( $response, 262144 );
		if ( ! DiscountOffersContracts::catalogue( $payload ) ) throw new ModaApiClientException( 'remote_response_invalid' );
		return $payload;
	}

	private function checkDiscountStatus( mixed $response ): void {
		$status = wp_remote_retrieve_response_code( $response );
		if ( 200 === $status ) return;
		if ( 401 === $status ) throw new ModaApiClientException( 'unauthorized', $status );
		if ( 400 === $status || 413 === $status ) throw new ModaApiClientException( 'invalid_request', $status );
		if ( 422 === $status || 409 === $status || 503 === $status ) {
			try { $code = self::decodeErrorBody( $response )['error'] ?? ''; }
			catch ( ModaApiClientException $error ) { $code = ''; }
			if ( in_array( $code, array( 'catalogue_not_current', 'selected_coupon_not_found',
				'selection_required', 'selection_limit_exceeded', 'offers_conflict' ), true ) ) {
				throw new ModaApiClientException( $code, $status );
			}
		}
		throw new ModaApiClientException( 'remote_unavailable', $status );
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
			'top_up_purchase_pending', 'top_up_bundle_not_found', 'top_up_purchase_unavailable',
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