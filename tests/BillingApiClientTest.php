<?php

use ModaInteract\WooCommerce\Api\BillingResponseValidator;
use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

final class BillingApiClientTest extends TestCase {
	public function test_billing_reads_use_installation_auth_and_optional_locale_without_tenant_input(): void {
		$requests = array();
		$payloads = array( self::billingPresentation(), self::planCatalogue() );
		$client = $this->client( static function ( string $url, array $args ) use ( &$requests, &$payloads ): array {
			$requests[] = array( $url, $args );
			return self::response( 200, array_shift( $payloads ) );
		} );

		self::assertSame( self::billingPresentation(), $client->billingPresentation( self::connection() ) );
		self::assertSame( self::planCatalogue(), $client->billingPlans( self::connection(), 'en-GB' ) );
		self::assertSame( 'https://api.example.test/v1/billing', $requests[0][0] );
		self::assertSame( 'https://api.example.test/v1/billing/plans?locale=en-GB', $requests[1][0] );
		foreach ( $requests as $request ) {
			self::assertSame( 'install_123', $request[1]['headers']['X-Moda-Installation-Id'] );
			self::assertSame( 'Bearer ' . self::connection()['credential'], $request[1]['headers']['Authorization'] );
			self::assertArrayNotHasKey( 'X-Shop-Id', $request[1]['headers'] );
			self::assertArrayNotHasKey( 'body', $request[1] );
			self::assertSame( 0, $request[1]['redirection'] );
			self::assertSame( array(), $request[1]['cookies'] );
		}
	}

	public function test_recurring_commands_map_action_id_only_to_idempotency_header_and_reduce_results(): void {
		$requests = array();
		$payloads = array( self::confirmation(), self::confirmation( 'PLAN_SWITCH' ), self::cancellation() );
		$client = $this->client( static function ( string $url, array $args ) use ( &$requests, &$payloads ): array {
			$requests[] = array( $url, $args );
			return self::response( 'DELETE' === $args['method'] ? 200 : 202, array_shift( $payloads ) );
		} );
		$action_id = '550e8400-e29b-41d4-a716-446655440000';

		self::assertSame( array( 'schemaVersion' => 1, 'operationId' => 'operation_1', 'state' => 'AWAITING_CONFIRMATION', 'confirmationUrl' => 'https://woocommerce.com/confirm/1' ), $client->createSubscription( self::connection(), 'plan_1', $action_id ) );
		self::assertSame( array( 'schemaVersion' => 1, 'operationId' => 'operation_1', 'state' => 'AWAITING_CONFIRMATION', 'confirmationUrl' => 'https://woocommerce.com/confirm/1' ), $client->switchSubscription( self::connection(), 'plan_1', $action_id ) );
		self::assertSame( array( 'schemaVersion' => 1, 'operationId' => 'operation_1', 'state' => 'CONFIRMED', 'confirmationUrl' => null ), $client->cancelSubscription( self::connection(), $action_id ) );
		self::assertSame( array( 'POST', 'POST', 'DELETE' ), array_column( array_column( $requests, 1 ), 'method' ) );
		self::assertSame( array(
			'https://api.example.test/v1/billing/subscription',
			'https://api.example.test/v1/billing/subscription/switch',
			'https://api.example.test/v1/billing/subscription',
		), array_column( $requests, 0 ) );
		foreach ( $requests as $request ) {
			self::assertSame( $action_id, $request[1]['headers']['Idempotency-Key'] );
			self::assertArrayNotHasKey( 'shopId', $request[1]['headers'] );
			if ( 'DELETE' === $request[1]['method'] ) {
				self::assertArrayNotHasKey( 'body', $request[1] );
			} else {
				self::assertSame( array( 'merchantPricingPlanId' => 'plan_1' ), json_decode( $request[1]['body'], true ) );
				self::assertArrayNotHasKey( 'actionId', json_decode( $request[1]['body'], true ) );
			}
		}
	}

	public function test_recovery_credit_purchase_sends_only_opaque_offer_and_validates_exact_confirmation(): void {
		$requests = array();
		$purchase = array( 'schemaVersion' => 1, 'purchaseId' => 'purchase_1', 'operationId' => 'operation_1', 'state' => 'AWAITING_CONFIRMATION', 'confirmationUrl' => 'https://woocommerce.com/confirm/1' );
		$client = $this->client( static function ( string $url, array $args ) use ( &$requests, $purchase ): array {
			$requests[] = array( $url, $args );
			return self::response( 202, $purchase );
		} );
		$action_id = '550e8400-e29b-41d4-a716-446655440000';

		self::assertSame( $purchase, $client->purchaseRecoveryCredits( self::connection(), 'usage_bronze', $action_id ) );
		self::assertSame( 'https://api.example.test/v1/billing/recovery-credit-purchases', $requests[0][0] );
		self::assertSame( 'POST', $requests[0][1]['method'] );
		self::assertSame( $action_id, $requests[0][1]['headers']['Idempotency-Key'] );
		self::assertSame( array( 'merchantPricingUsageEventId' => 'usage_bronze' ), json_decode( $requests[0][1]['body'], true ) );
		self::assertArrayNotHasKey( 'shopId', $requests[0][1]['headers'] );

		foreach ( array(
			array_merge( $purchase, array( 'providerContractId' => 'must_not_escape' ) ),
			array_merge( $purchase, array( 'purchaseId' => ' ' ) ),
			array_merge( $purchase, array( 'state' => 'CONFIRMED' ) ),
			array_merge( $purchase, array( 'confirmationUrl' => 'https://woocommerce.com.attacker.test/confirm' ) ),
		) as $invalid ) {
			$invalid_client = $this->client( static fn() => self::response( 202, $invalid ) );
			try {
				$invalid_client->purchaseRecoveryCredits( self::connection(), 'usage_bronze', $action_id );
				self::fail( 'Expected invalid purchase response rejection.' );
			} catch ( ModaApiClientException $error ) {
				self::assertSame( 'remote_response_invalid', $error->getMessage() );
			}
		}
	}

	public function test_contract_validator_rejects_unknown_fields_versions_and_untrusted_confirmation_hosts(): void {
		$presentation = self::billingPresentation();
		self::assertTrue( BillingResponseValidator::isPresentation( $presentation ) );
		$presentation['unexpected'] = true;
		self::assertFalse( BillingResponseValidator::isPresentation( $presentation ) );

		$catalogue = self::planCatalogue();
		$catalogue['schemaVersion'] = 2;
		self::assertFalse( BillingResponseValidator::isPlanCatalogue( $catalogue ) );

		foreach ( array( 'http://woocommerce.com/confirm', 'https://example.com/confirm', 'https://user@woocommerce.com/confirm', 'https://sandbox.woocommerce.com.attacker.example/confirm' ) as $url ) {
			self::assertFalse( BillingResponseValidator::confirmationUrl( $url ) );
		}
		self::assertTrue( BillingResponseValidator::confirmationUrl( 'https://sandbox.woocommerce.com/confirm?token=opaque' ) );
	}

	public function test_client_rejects_an_invalid_billing_schema_as_a_bounded_error(): void {
		$payload = self::billingPresentation();
		$payload['schemaVersion'] = 2;
		$client = $this->client( static fn() => self::response( 200, $payload ) );
		try {
			$client->billingPresentation( self::connection() );
			self::fail( 'Expected invalid response rejection.' );
		} catch ( ModaApiClientException $error ) {
			self::assertSame( 'remote_response_invalid', $error->getMessage() );
		}
	}

	public function test_billing_command_errors_extract_only_allowlisted_hosted_codes(): void {
		$client = $this->client( static fn() => self::response( 409, array( 'error' => 'billing_operation_in_progress', 'message' => 'private provider details' ) ) );
		try {
			$client->createSubscription( self::connection(), 'plan_1', '550e8400-e29b-41d4-a716-446655440000' );
			self::fail( 'Expected remote rejection.' );
		} catch ( ModaApiClientException $error ) {
			self::assertSame( 'remote_rejected', $error->getMessage() );
			self::assertSame( 'billing_operation_in_progress', $error->remote_error );
			self::assertStringNotContainsString( 'private provider details', $error->getMessage() );
		}

		$untrusted = $this->client( static fn() => self::response( 409, array( 'error' => 'private provider details' ) ) );
		try {
			$untrusted->createSubscription( self::connection(), 'plan_1', '550e8400-e29b-41d4-a716-446655440000' );
			self::fail( 'Expected remote rejection.' );
		} catch ( ModaApiClientException $error ) {
			self::assertNull( $error->remote_error );
		}
	}

	private function client( callable $transport ): ModaApiClient {
		return new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport );
	}

	private static function response( int $status, array $payload ): array {
		return array( 'headers' => array( 'content-type' => 'application/json; charset=utf-8' ), 'body' => wp_json_encode( $payload ), 'response' => array( 'code' => $status ) );
	}

	private static function connection(): array {
		return array( 'schemaVersion' => 1, 'installationId' => 'install_123', 'shopId' => 'shop_456', 'canonicalSiteUrl' => 'https://merchant.example', 'credential' => Base64Url::encode( str_repeat( "\x07", 32 ) ), 'credentialVersion' => 1, 'connectedAt' => '2026-10-09T00:00:00Z' );
	}

	private static function billingPresentation(): array {
		return array(
			'schemaVersion' => 1,
			'experienceState' => 'ACTIVE',
			'surfaces' => array( 'usageHistoryAllowed' => true, 'purchaseHistoryAllowed' => true, 'managePlansAllowed' => true, 'cancelSubscriptionAllowed' => false ),
			'currentPlan' => array( 'merchantPricingPlanId' => 'plan_free', 'displayName' => 'Free', 'planKind' => 'FREE', 'recurringAmountMinor' => 0, 'currency' => 'USD', 'billingPeriod' => 'EVERY_30_DAYS', 'currentPeriodEnd' => null, 'cancelAtPeriodEnd' => false, 'cancellationEffectiveAt' => null ),
			'pendingPlan' => null,
			'pendingCancellation' => null,
			'capacity' => array(
				'paidIncluded' => null,
				'freeLifetime' => array( 'granted' => 2, 'committed' => 0, 'reserved' => 0, 'remaining' => 2 ),
				'promotional' => array( 'granted' => 0, 'committed' => 0, 'reserved' => 0, 'remaining' => 0 ),
				'purchased' => array( 'granted' => 0, 'committed' => 0, 'reserved' => 0, 'refunding' => 0, 'available' => 0 ),
			),
			'topUps' => array( 'configured' => false, 'purchaseEligible' => false, 'offers' => array(), 'latestPurchase' => null, 'unresolvedPurchases' => array() ),
		);
	}

	private static function planCatalogue(): array {
		return array( 'schemaVersion' => 1, 'resolvedLocale' => 'en-GB', 'plans' => array( array( 'merchantPricingPlanId' => 'plan_paid', 'displayName' => 'Growth', 'planKind' => 'PAID_METERED', 'cataloguePosition' => 1, 'featured' => true, 'localizedDescription' => 'Growth plan', 'includedRecoveryCredits' => 10, 'allowancePeriod' => 'EVERY_30_DAYS', 'billingPeriod' => 'EVERY_30_DAYS', 'recurringAmountMinor' => 4900, 'currency' => 'USD', 'highlights' => array() ) ) );
	}

	private static function confirmation( string $kind = 'SUBSCRIPTION_CREATE' ): array {
		return array( 'schemaVersion' => 1, 'operationId' => 'operation_1', 'kind' => $kind, 'state' => 'AWAITING_CONFIRMATION', 'confirmationUrl' => 'https://woocommerce.com/confirm/1' );
	}

	private static function cancellation(): array {
		return array( 'schemaVersion' => 1, 'operationId' => 'operation_1', 'kind' => 'CANCEL', 'state' => 'CONFIRMED', 'confirmationUrl' => null );
	}
}