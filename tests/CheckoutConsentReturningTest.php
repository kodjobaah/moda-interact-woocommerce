<?php

/** ARCH-046-WOOCOMMERCE-003: returning checkout actions, not WordPress E2E. */

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCheckbox;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentEligibility;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentPublisher;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

// Reuse the same Woo WC-session, Store API request, and Cart-Token fixtures.
require_once __DIR__ . '/fixtures/Arch046CheckoutTestFakes.php';

final class CheckoutConsentReturningTest extends TestCase {
	private array $requests = array();
	private CheckoutConsentCapture $capture;
	private CheckoutConsentPublisher $publisher;
	private bool $feature = true;
	private bool $unavailable = false;

	protected function setUp(): void {
		$GLOBALS['arch046_nonce_action'] = 'update-order-review';
		$GLOBALS['arch046_current_user_id'] = 0;
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_store_locale'] = 'en_GB';
		$GLOBALS['moda_interact_options'] = array( 'blogname' => 'Test Merchant' );
		$GLOBALS['arch046_scheduled'] = array();
		$GLOBALS['arch035_delayed'] = array();
		$GLOBALS['moda_interact_external_requests'] = array();
		$GLOBALS['arch046_woo'] = (object) array(
			'session' => new Arch046Session(), 'cart' => new Arch046Cart(),
			'customer' => new Arch046Customer(), 'countries' => new Arch046Countries(),
		);
		$GLOBALS['arch035_wc'] = $GLOBALS['arch046_woo'];
		$record = array( 'schemaVersion' => 1, 'installationId' => 'installation-a',
			'shopId' => 'shop-a', 'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( 'a', 32 ) ),
			'credentialVersion' => 1, 'connectedAt' => '2026-10-23T10:00:00Z' );
		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = $record;
		$this->requests = array();
		$this->feature = true;
		$this->unavailable = false;
		$transport = function ( string $url, array $request ) {
			$path = parse_url( $url, PHP_URL_PATH );
			if ( '/v1/merchant/feature-preferences' === $path ) {
				return $this->response( 200, array( 'schemaVersion' => 1, 'revision' => str_repeat( 'a', 64 ),
					'features' => array( array( 'id' => 'feature-1', 'key' => 'checkout_recovery',
					'name' => 'Checkout Recovery', 'description' => null,
					'enabled' => true, 'effective' => $this->feature,
					'editable' => false, 'required' => true, 'planEligible' => true ) ) ) );
			}
			$this->requests[] = array( $url, $request );
			if ( $this->unavailable ) return $this->response( 503, array( 'error' => 'unavailable' ) );
			$event = json_decode( $request['body'], true );
			return $this->response( 200, array( 'schemaVersion' => 'woo.whatsapp-consent.v1',
				'status' => 'recorded', 'decision' => $event['decision'],
				'consentRevision' => (string) count( $this->requests ),
				'decisionSequence' => (string) count( $this->requests ) ) );
		};
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport );
		$site = new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn( string $host ) => array( '93.184.216.34' ) );
		$publisher = new CheckoutConsentPublisher( $client, new InstallationStore(), $site );
		$this->publisher = $publisher;
		$eligibility = new CheckoutConsentEligibility( $client, $site, new InstallationStore() );
		$this->capture = new CheckoutConsentCapture( $publisher, $eligibility );
	}

	protected function tearDown(): void { unset( $GLOBALS['arch046_nonce_action'], $GLOBALS['arch046_current_user_id'] ); }

	private function response( int $status, array $payload ): array {
		return array( 'response' => array( 'code' => $status ),
			'headers' => array( 'content-type' => 'application/json' ), 'body' => json_encode( $payload ) );
	}

	private function classic( bool $checked, string $phone = '+447400123456', string $nonce = 'arch046-fixture-nonce' ): void {
		$_POST['security'] = $nonce;
		$this->capture->classicReview( 'billing_phone=' . rawurlencode( $phone ) . '&billing_country=GB' .
			( $checked ? '&' . CheckoutConsentCheckbox::CLASSIC_FIELD . '=1' : '' ) );
	}

	/** Returning customers can revoke without first ticking the default-unchecked opt-in. */
	public function test_later_classic_checkout_explicit_withdrawal_does_not_mint_a_grant(): void {
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$this->capture->endCheckout();
		$_POST['security'] = 'arch046-fixture-nonce';
		$form = 'billing_phone=%2B447400123456&billing_country=GB&' .
			CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=withdraw';
		$this->capture->classicReview( $form );
		$this->capture->classicReview( $form );
		self::assertCount( 2, $this->requests, 'Replayed choice cannot mint another REVOKE' );
		$grant = json_decode( $this->requests[0][1]['body'], true );
		$revoke = json_decode( $this->requests[1][1]['body'], true );
		self::assertSame( 'GRANT', $grant['decision'] );
		self::assertSame( 'REVOKE', $revoke['decision'] );
		self::assertSame( $grant['canonicalPhone'], $revoke['canonicalPhone'] );
		self::assertNotSame( $grant['eventId'], $revoke['eventId'] );
		self::assertSame( 'UNCHECKED', $revoke['checkoutAction']['selection'] );
		self::assertNull( $revoke['disclosure'] );
		self::assertCount( 0, $GLOBALS['moda_interact_external_requests'], 'No consent-driven checkout or recovery activity' );
	}

	public function test_returning_classic_unchecked_default_and_conflicting_selection_never_withdraw(): void {
		$_POST['security'] = 'arch046-fixture-nonce';
		$base = 'billing_phone=%2B447400123456&billing_country=GB';
		$this->capture->classicReview( $base );
		$this->capture->classicReview( $base . '&' . CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=unchanged' );
		self::assertCount( 0, $this->requests );
		$this->capture->classicReview( $base . '&' . CheckoutConsentCheckbox::CLASSIC_FIELD . '=1&' .
			CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=withdraw' );
		$this->capture->classicReview( $base . '&' . CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=invalid' );
		self::assertCount( 0, $this->requests, 'Contradictory or malformed choice cannot be recorded' );
		$this->capture->classicReview( $base . '&' . CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=withdraw' );
		self::assertCount( 1, $this->requests );
		self::assertSame( 'REVOKE', json_decode( $this->requests[0][1]['body'], true )['decision'] );
	}

	public function test_later_blocks_explicit_withdrawal_is_verified_and_deduplicated(): void {
		$GLOBALS['arch046_nonce_action'] = 'wc_store_api';
		$fields = array( CheckoutConsentCheckbox::BLOCK_FIELD => false,
			CheckoutConsentCheckbox::BLOCK_WITHDRAW_FIELD => 'withdraw' );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( $fields, 'forged' ) );
		self::assertCount( 0, $this->requests );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( $fields ) );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( $fields ) );
		self::assertCount( 1, $this->requests );
		$event = json_decode( $this->requests[0][1]['body'], true );
		self::assertSame( 'REVOKE', $event['decision'] );
		self::assertSame( 'BLOCKS', $event['checkoutAction']['checkoutMode'] );
		self::assertSame( '447400123456', $event['canonicalPhone'] );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array(
			CheckoutConsentCheckbox::BLOCK_FIELD => true,
			CheckoutConsentCheckbox::BLOCK_WITHDRAW_FIELD => 'withdraw',
		) ) );
		self::assertCount( 1, $this->requests, 'Conflicting simultaneous GRANT/REVOKE denied' );
	}

	public function test_later_blocks_withdrawal_waits_for_verified_phone_and_never_inherits_login(): void {
		$GLOBALS['arch046_nonce_action'] = 'wc_store_api';
		$customer = $GLOBALS['arch046_woo']->customer;
		$customer->phone = '';
		$fields = array( CheckoutConsentCheckbox::BLOCK_WITHDRAW_FIELD => 'withdraw' );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( $fields ) );
		self::assertCount( 0, $this->requests );
		$stage = $GLOBALS['arch046_woo']->session->get( 'moda_interact_checkout_blocks_waiting_for_phone_v1' );
		self::assertSame( 'REVOKE', $stage['choice'] );
		$GLOBALS['arch046_current_user_id'] = 44;
		$customer->phone = '+447400123456';
		$this->capture->blocksBillingUpdated( $customer, new Arch046CheckoutRequest( array(), 'arch046-fixture-nonce', 'POST' ) );
		self::assertCount( 0, $this->requests, 'A different login cannot inherit another tab withdrawal' );
		$GLOBALS['arch046_current_user_id'] = 0;
		$customer->phone = '';
		$this->capture->blocksDraft( new Arch046CheckoutRequest( $fields ) );
		$customer->phone = '+447400123456';
		$this->capture->blocksBillingUpdated( $customer, new Arch046CheckoutRequest( array(), 'arch046-fixture-nonce', 'POST' ) );
		self::assertCount( 1, $this->requests );
		self::assertSame( 'REVOKE', json_decode( $this->requests[0][1]['body'], true )['decision'] );
		$this->capture->blocksBillingUpdated( $customer, new Arch046CheckoutRequest( array(), 'arch046-fixture-nonce', 'POST' ) );
		self::assertCount( 1, $this->requests );
	}

	public function test_returning_checkout_changed_phone_must_be_reobserved_before_withdrawal(): void {
		$_POST['security'] = 'arch046-fixture-nonce';
		$initial = 'billing_phone=%2B447400123456&billing_country=GB&' .
			CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=unchanged';
		$this->capture->classicReview( $initial );
		$changed = 'billing_phone=%2B447400123457&billing_country=GB&' .
			CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=withdraw';
		$this->capture->classicReview( $changed );
		self::assertCount( 0, $this->requests, 'Changed phone cannot inherit previous choice' );
		$this->capture->classicReview( $changed );
		self::assertCount( 0, $this->requests, 'Repeated stale choice still cannot act' );
		$this->capture->classicReview( 'billing_phone=%2B447400123457&billing_country=GB&' .
			CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=unchanged' );
		$this->capture->classicReview( $changed );
		self::assertCount( 1, $this->requests );
		self::assertSame( '447400123457', json_decode( $this->requests[0][1]['body'], true )['canonicalPhone'] );
	}

	public function test_explicit_withdrawal_fails_closed_on_feature_or_installation_revocation(): void {
		$_POST['security'] = 'arch046-fixture-nonce';
		$action = 'billing_phone=%2B447400123456&billing_country=GB&' .
			CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=withdraw';
		$this->feature = false;
		$this->capture->classicReview( $action );
		self::assertCount( 0, $this->requests );
		$this->feature = true;
		$connection = ( new InstallationStore() )->read()['record'];
		unset( $GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] );
		$this->capture->classicReview( $action );
		self::assertCount( 0, $this->requests );
		( new InstallationStore() )->save( $connection );
		$this->capture->classicReview( $action );
		self::assertCount( 1, $this->requests );
	}

	public function test_later_withdrawal_outage_replays_identical_event_without_checkout_side_effect(): void {
		$_POST['security'] = 'arch046-fixture-nonce';
		$action = 'billing_phone=%2B447400123456&billing_country=GB&' .
			CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=withdraw';
		$this->unavailable = true;
		$this->capture->classicReview( $action );
		self::assertCount( 1, $this->requests );
		$first = json_decode( $this->requests[0][1]['body'], true );
		self::assertSame( 'REVOKE', $first['decision'] );
		$this->unavailable = false;
		$this->capture->classicReview( $action );
		self::assertCount( 2, $this->requests );
		self::assertSame( $first, json_decode( $this->requests[1][1]['body'], true ) );
		$this->capture->classicReview( $action );
		self::assertCount( 2, $this->requests );
		self::assertCount( 0, $GLOBALS['moda_interact_external_requests'] );
	}

	public function test_returning_checkout_requires_new_explicit_grant_after_withdrawal(): void {
		$_POST['security'] = 'arch046-fixture-nonce';
		$withdraw = 'billing_phone=%2B447400123456&billing_country=GB&' .
			CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=withdraw';
		$this->capture->classicReview( $withdraw );
		self::assertCount( 1, $this->requests );
		$this->capture->endCheckout();
		// New checkout starts unchecked regardless of previous permission.
		$this->classic( false );
		self::assertCount( 1, $this->requests );
		$this->classic( true );
		self::assertCount( 2, $this->requests );
		$revoked = json_decode( $this->requests[0][1]['body'], true );
		$regranted = json_decode( $this->requests[1][1]['body'], true );
		self::assertSame( array( 'REVOKE', 'GRANT' ), array( $revoked['decision'], $regranted['decision'] ) );
		self::assertSame( $revoked['canonicalPhone'], $regranted['canonicalPhone'] );
		self::assertNotSame( $revoked['eventId'], $regranted['eventId'] );
		self::assertCount( 0, $GLOBALS['moda_interact_external_requests'] );
	}

	public function test_previous_session_action_scheduler_retry_is_cancelled_on_login_and_phone_change(): void {
		$this->unavailable = true;
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$scheduled = $GLOBALS['arch035_delayed'][0]['args'];
		$this->unavailable = false;
		$this->capture->invalidatePendingSession();
		$this->publisher->deliver( ...array_values( $scheduled ) );
		self::assertCount( 1, $this->requests, 'Previous account retry is cancelled on logout/login' );

		$this->unavailable = true;
		$this->classic( true );
		self::assertCount( 2, $this->requests );
		$old_phone = $GLOBALS['arch035_delayed'][1]['args'];
		$this->unavailable = false;
		$this->classic( true, '+447400123457' );
		$this->publisher->deliver( ...array_values( $old_phone ) );
		self::assertCount( 2, $this->requests, 'Phone-change invalidates pending previous-phone retry' );
	}

	public function test_returning_blocks_withdrawal_requires_matching_guest_cart_token(): void {
		$GLOBALS['arch046_nonce_action'] = 'wc_store_api';
		$choice = array( CheckoutConsentCheckbox::BLOCK_WITHDRAW_FIELD => 'withdraw' );
		$token = \Automattic\WooCommerce\StoreApi\Utilities\CartTokenUtils::get_cart_token( 'guest-session-1' );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( $choice, '', 'PUT', 'forged' ) );
		self::assertCount( 0, $this->requests );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( $choice, '', 'PUT', $token ) );
		self::assertCount( 1, $this->requests );
		self::assertSame( 'REVOKE', json_decode( $this->requests[0][1]['body'], true )['decision'] );
		$GLOBALS['arch046_woo']->session->set( 'customer_id', 'another-guest' );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( $choice, '', 'PUT', $token ) );
		self::assertCount( 1, $this->requests );
	}
	public function test_queued_decision_cannot_cross_credential_rotation_with_same_installation_id(): void {
		$_POST['security'] = 'arch046-fixture-nonce';
		$this->unavailable = true;
		$this->capture->classicReview( 'billing_phone=%2B447400123456&billing_country=GB&' .
			CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD . '=withdraw' );
		self::assertCount( 1, $this->requests );
		$scheduled = $GLOBALS['arch035_delayed'][0]['args'];
		$record = ( new InstallationStore() )->read()['record'];
		$record['credentialVersion']++;
		( new InstallationStore() )->save( $record );
		$this->unavailable = false;
		$this->publisher->deliver( ...array_values( $scheduled ) );
		self::assertCount( 1, $this->requests, 'Credential rotation must invalidate previously attested event' );
	}

}
