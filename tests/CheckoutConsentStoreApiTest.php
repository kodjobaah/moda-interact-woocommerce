<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentEligibility;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentProof;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentStatusReader;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentStoreApi;
use ModaInteract\WooCommerce\Checkout\CheckoutKey;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fixtures/Arch046CheckoutTestFakes.php';
require_once __DIR__ . '/fixtures/Arch046StoreApiFakes.php';
require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutConsentStoreApi.php';

final class CheckoutConsentStoreApiTest extends TestCase {
	private CheckoutConsentStoreApi $api;
	private array $events = array();
	private bool $unavailable = false;

	protected function setUp(): void {
		$GLOBALS['arch046_current_user_id'] = 0;
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_store_locale'] = 'en_GB';
		$GLOBALS['moda_interact_options'] = array( 'blogname' => 'Test Merchant' );
		$GLOBALS['arch046_woo'] = (object) array(
			'session' => new Arch046Session(), 'cart' => new Arch046Cart(),
			'customer' => new Arch046Customer(), 'countries' => new Arch046Countries(),
		);
		$GLOBALS['arch035_wc'] = $GLOBALS['arch046_woo'];
		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = array(
			'schemaVersion' => 1, 'installationId' => 'installation-a',
			'shopId' => 'shop-a', 'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( 'a', 32 ) ),
			'credentialVersion' => 1, 'connectedAt' => '2026-10-23T10:00:00Z',
		);
		$GLOBALS['moda_interact_external_requests'] = array();
		$this->unavailable = false;
		$transport = function ( string $url, array $request ): array {
			if ( '/v1/merchant/feature-preferences' === parse_url( $url, PHP_URL_PATH ) ) {
				return $this->response( 200, array( 'schemaVersion' => 1, 'revision' => str_repeat( 'a', 64 ),
					'features' => array( array( 'id' => 'f1', 'key' => 'checkout_recovery', 'name' => 'Recovery',
					'description' => null, 'enabled' => true, 'effective' => true,
					'editable' => false, 'required' => true, 'planEligible' => true ) ) ) );
			}
			$this->events[] = json_decode( $request['body'], true );
			if ( $this->unavailable ) return $this->response( 503, array( 'error' => 'unavailable' ) );
			$event = end( $this->events );
			return $this->response( 200, array( 'schemaVersion' => 'woo.whatsapp-consent.v2',
				'status' => 'recorded', 'decision' => $event['decision'],
				'consentRevision' => (string) count( $this->events ),
				'decisionSequence' => (string) count( $this->events ) ) );
		};
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport );
		$site = new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn( string $host ): array => array( '93.184.216.34' ) );
		$publisher = new CheckoutConsentPublisher( $client, new InstallationStore(), $site );
		$eligibility = new CheckoutConsentEligibility( new InstallationStore() );
		$capture = new CheckoutConsentCapture( $publisher, $eligibility, new CheckoutConsentProof(),
			new CheckoutConsentStatusReader( static fn( array $proof ): string => 'CONFIRMED_GRANTED' ) );
		$this->api = new CheckoutConsentStoreApi( $capture );
	}

	/** Consent fixture nonce overrides must never affect other REST suites. */
	protected function tearDown(): void {
		unset( $GLOBALS['arch046_nonce_action'], $GLOBALS['arch046_current_user_id'] );
		parent::tearDown();
	}

	private function response( int $status, array $payload ): array {
		return array( 'response' => array( 'code' => $status ),
			'headers' => array( 'content-type' => 'application/json' ), 'body' => json_encode( $payload ) );
	}

	private function action( string $action, string $id = 'm-1', array $extra = array() ): array {
		return array_merge( array( 'action' => $action, 'requestId' => $id,
			'expectedPhone' => '+447400123456', 'expectedCountry' => 'GB' ), $extra );
	}

	public function test_registered_callback_uses_woocommerce_cart_extensions_only(): void {
		$this->api->registerCallbacks();
		self::assertSame( CheckoutConsentStoreApi::NAMESPACE, $GLOBALS['arch046_store_api_update']['namespace'] );
		self::assertSame( 'cart', $GLOBALS['arch046_store_api_schema']['endpoint'] );
		self::assertSame( CheckoutConsentStoreApi::NAMESPACE, $GLOBALS['arch046_store_api_schema']['namespace'] );
		self::assertSame( array( 'requestId', 'status', 'confirmed', 'reason' ),
			array_keys( ( $GLOBALS['arch046_store_api_schema']['data_callback'] )() ) );
	}

	public function test_unexpected_callback_exception_preserves_safe_request_id_for_client_ack(): void {
		$customer = WC()->customer;
		try {
			WC()->customer = new class {
				public function get_billing_phone(): string {
					throw new \RuntimeException( 'simulated Woo customer read failure' );
				}
				public function get_billing_country(): string { return 'GB'; }
			};
			$this->api->update( $this->action( 'choice', 'safe-request-1', array( 'checked' => true ) ) );
			self::assertSame( array( 'requestId' => 'safe-request-1',
				'status' => 'unverified', 'confirmed' => false,
				'reason' => 'capture_observe_unclassified' ), $this->api->data() );
			$this->api->update( $this->action( 'choice', 'bad request id', array( 'checked' => true ) ) );
			self::assertSame( '', $this->api->data()['requestId'] );
		} finally {
			WC()->customer = $customer;
		}
	}

	public function test_blocks_grant_mints_consent_only_key_without_starting_checkout_activity(): void {
		$session = WC()->session;
		self::assertNull( CheckoutKey::existing() );
		$this->api->update( $this->action( 'choice', 'consent-only-grant', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		$key = CheckoutKey::existing();
		self::assertNotNull( $key );
		self::assertSame( $key, $session->get( CheckoutKey::CONSENT_ONLY_SESSION_FIELD ) );
		self::assertTrue( CheckoutKey::isConsentOnly() );
		$this->api->update( $this->action( 'status', 'consent-only-status' ) );
		self::assertTrue( $this->api->data()['confirmed'] );
		self::assertTrue( CheckoutKey::isConsentOnly(), 'Proof reads never start recovery checkout' );
	}

	public function test_status_is_read_only_and_does_not_reveal_grant_proof(): void {
		$session = WC()->session;
		$session->set( CheckoutKey::SESSION_FIELD, null );
		$this->api->update( $this->action( 'status' ) );
		self::assertSame( array( 'requestId' => 'm-1', 'status' => 'checked',
			'confirmed' => false, 'reason' => 'consent_proof_missing' ), $this->api->data() );
		self::assertNull( $session->get( CheckoutKey::SESSION_FIELD ) );
		self::assertCount( 0, $this->events );
		self::assertArrayNotHasKey( 'grantEventId', $this->api->data() );
	}

	public function test_grant_and_confirmed_withdraw_record_ordered_distinct_events(): void {
		$this->api->update( $this->action( 'choice', 'm-grant', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertSame( 'GRANT', $this->events[0]['decision'] );
		$this->api->update( $this->action( 'status', 'm-status' ) );
		self::assertSame( true, $this->api->data()['confirmed'] );
		$this->api->update( $this->action( 'choice', 'm-uncheck', array( 'checked' => false ) ) );
		self::assertSame( 'store_api_choice_value_invalid', $this->api->data()['reason'] );
		self::assertCount( 1, $this->events, 'A checkbox uncheck cannot withdraw' );
		$this->api->update( $this->action( 'withdraw', 'm-revoke', array( 'confirmed' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertSame( 'REVOKE', $this->events[1]['decision'] );
		self::assertNotSame( $this->events[0]['eventId'], $this->events[1]['eventId'] );
	}

	public function test_invalid_or_stale_contact_does_not_mutate_merchant_state(): void {
		$session = WC()->session;
		$original = $session->items;
		$cart = WC()->cart;
		$customer = WC()->customer;
		$this->api->update( $this->action( 'choice', 'm-other', array(
			'expectedPhone' => '+447400123457', 'checked' => true,
		) ) );
		self::assertSame( 'unverified', $this->api->data()['status'] );
		self::assertSame( 'store_api_billing_phone_mismatch', $this->api->data()['reason'] );
		self::assertSame( $original, $session->items );
		self::assertSame( $cart, WC()->cart );
		self::assertSame( $customer, WC()->customer );
		self::assertCount( 0, $this->events );
	}

	public function test_no_session_and_missing_checkout_contact_fail_closed(): void {
		$session = WC()->session;
		$customer = WC()->customer;
		WC()->session = null;
		$this->api->update( $this->action( 'choice', 'm-missing', array( 'checked' => true ) ) );
		self::assertSame( 'store_api_session_unavailable', $this->api->data()['reason'] );
		self::assertNull( WC()->session );
		WC()->session = $session;
		WC()->customer = null;
		$this->api->update( $this->action( 'status', 'm-missing-customer' ) );
		self::assertSame( 'store_api_customer_unavailable', $this->api->data()['reason'] );
		WC()->customer = $customer;
		self::assertCount( 0, $this->events );
	}

	public function test_new_explicit_store_choice_can_regrant_after_unverified_returning_checkout(): void {
		$woo = WC();
		$cart = $woo->cart;
		$customer = $woo->customer;
		$cartLoadsBefore = $GLOBALS['arch046_wc_load_cart_calls'] ?? 0;
		$this->api->update( $this->action( 'choice', 'original-grant', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertCount( 1, $this->events );

		// This shopper has an older ACK in Moda's session, but the new checkout
		// has no retained grant proof. Status must stay read-only and unverified.
		$woo->session->set( 'moda_woo_checkout_grant_proof_v1', null );
		$before = $woo->session->get( 'moda_interact_checkout_consent_observation_v2' );
		$this->api->update( $this->action( 'status', 'fresh-page-status' ) );
		self::assertFalse( $this->api->data()['confirmed'] );
		self::assertSame( $before, $woo->session->get( 'moda_interact_checkout_consent_observation_v2' ) );

		$this->api->update( $this->action( 'choice', 'new-visible-checkbox-click', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertCount( 2, $this->events );
		self::assertSame( 'GRANT', $this->events[1]['decision'] );
		self::assertNotSame( $this->events[0]['eventId'], $this->events[1]['eventId'] );
		self::assertSame( $cart, WC()->cart, 'No cart replacement by Moda' );
		self::assertSame( $customer, WC()->customer, 'No customer replacement by Moda' );
		self::assertSame( $cartLoadsBefore, $GLOBALS['arch046_wc_load_cart_calls'] ?? 0 );

		// A Woo retry reuses the SAME browser request ID. It may be ACKed but
		// must never create a second event, even if other requests have run.
		$this->api->update( $this->action( 'choice', 'new-visible-checkbox-click', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertCount( 2, $this->events );
		// Unrelated automatic checkout refreshes cannot create a new grant.
		$GLOBALS['arch046_nonce_action'] = 'wc_store_api';
		$this->api->update( $this->action( 'status', 'status-again' ) );
		self::assertCount( 2, $this->events );
	}

	public function test_uncheck_reverses_ambiguous_store_grant_and_replays_cannot_override_newer_choice(): void {
		$this->unavailable = true;
		$this->api->update( $this->action( 'choice', 'unstable-grant', array( 'checked' => true ) ) );
		self::assertSame( 'capture_observe_grant_publish_unacknowledged', $this->api->data()['reason'] );
		self::assertCount( 1, $this->events );
		$first = $this->events[0];
		$lease_key = 'moda_woo_consent_retry_' . hash( 'sha256', $first['eventId'] );
		self::assertIsArray( get_transient( $lease_key ) );

		$this->api->update( $this->action( 'withdraw', 'unstable-uncheck', array( 'confirmed' => true ) ) );
		self::assertSame( 'capture_observe_revoke_publish_unacknowledged', $this->api->data()['reason'] );
		self::assertFalse( get_transient( $lease_key ) );
		self::assertCount( 2, $this->events, 'Explicit uncheck sends REVOKE despite ambiguous GRANT ACK' );
		self::assertSame( 'REVOKE', $this->events[1]['decision'] );

		$this->unavailable = false;
		$this->api->update( $this->action( 'withdraw', 'unstable-uncheck', array( 'confirmed' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertSame( $this->events[1]['eventId'], $this->events[2]['eventId'],
			'Retry uses the identical withdrawal event' );
		$this->api->update( $this->action( 'choice', 'unstable-grant', array( 'checked' => true ) ) );
		self::assertSame( 'capture_observe_store_choice_stale_replay', $this->api->data()['reason'] );
		$this->api->update( $this->action( 'choice', 'new-deliberate-grant', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertCount( 4, $this->events );
		self::assertNotSame( $first['eventId'], $this->events[3]['eventId'] );

		$this->api->update( $this->action( 'withdraw', 'unstable-uncheck', array( 'confirmed' => true ) ) );
		self::assertSame( 'capture_observe_store_choice_stale_replay', $this->api->data()['reason'] );
		self::assertCount( 4, $this->events, 'Old withdrawal cannot undo a newer GRANT' );
	}

	public function test_store_choice_replay_cannot_regrant_after_withdrawal_or_change_decision(): void {
		$this->api->update( $this->action( 'choice', 'first-grant', array( 'checked' => true ) ) );
		$this->api->update( $this->action( 'withdraw', 'revoke-action', array( 'confirmed' => true ) ) );
		self::assertCount( 2, $this->events );
		$this->api->update( $this->action( 'choice', 'first-grant', array( 'checked' => true ) ) );
		self::assertSame( 'capture_observe_store_choice_stale_replay', $this->api->data()['reason'] );
		$this->api->update( $this->action( 'choice', 'revoke-action', array( 'checked' => true ) ) );
		self::assertSame( 'capture_observe_store_choice_id_conflict', $this->api->data()['reason'] );
		self::assertCount( 2, $this->events );
		$this->api->update( $this->action( 'withdraw', 'revoke-action', array( 'confirmed' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertCount( 2, $this->events );
	}

	public function test_action_receipts_fail_closed_when_checkout_history_is_full(): void {
		for ( $i = 0; $i < 15; $i++ ) {
			$this->api->update( $this->action( 'choice', 'grant-' . $i,
				array( 'checked' => true ) ) );
			self::assertSame( 'recorded', $this->api->data()['status'] );
			$this->api->update( $this->action( 'withdraw', 'withdraw-' . $i,
				array( 'confirmed' => true ) ) );
			self::assertSame( 'recorded', $this->api->data()['status'] );
		}
		self::assertCount( 30, $this->events );
		$this->api->update( $this->action( 'choice', 'blocked-grant', array( 'checked' => true ) ) );
		self::assertSame( 'capture_observe_store_choice_history_full', $this->api->data()['reason'] );
		$this->api->update( $this->action( 'choice', 'grant-0', array( 'checked' => true ) ) );
		self::assertSame( 'capture_observe_store_choice_stale_replay', $this->api->data()['reason'] );
		self::assertCount( 30, $this->events );
	}

	public function test_history_limit_never_prevents_customer_withdrawal(): void {
		$this->api->update( $this->action( 'choice', 'initial-grant', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		$session = WC()->session;
		$state = $session->get( 'moda_interact_checkout_consent_observation_v2' );
		// Model a saturated history without sending arbitrary extra API events.
		$state['storeChoiceReceipts'] = array();
		for ( $i = 0; $i < 30; $i++ ) {
			$state['storeChoiceReceipts'][ hash( 'sha256', 'prior-choice-' . $i ) ] = 'GRANT';
		}
		$session->set( 'moda_interact_checkout_consent_observation_v2', $state );
		$this->api->update( $this->action( 'choice', 'blocked-new-grant', array( 'checked' => true ) ) );
		self::assertSame( 'capture_observe_store_choice_history_full', $this->api->data()['reason'] );
		$this->api->update( $this->action( 'withdraw', 'customer-withdraws', array( 'confirmed' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertSame( 'REVOKE', $this->events[1]['decision'] );
		self::assertCount( 2, $this->events );
	}

	public function test_capture_diagnostics_identify_the_exact_checkout_rejection(): void {
		$this->api->update( $this->action( 'choice', 'first-grant', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		$this->api->update( $this->action( 'choice', 'first-grant', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertCount( 1, $this->events, 'Identical request ID never creates another consent event' );

		$this->api->update( $this->action( 'withdraw', 'withdraw-grant', array( 'confirmed' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		$this->api->update( $this->action( 'choice', 'duplicate-uncheck', array( 'checked' => false ) ) );
		self::assertSame( 'store_api_choice_value_invalid', $this->api->data()['reason'] );
		self::assertCount( 2, $this->events, 'Repeated unchecked state cannot create another REVOKE' );

		$cart = WC()->cart;
		try {
			WC()->cart = new class {
				public function get_cart(): array { return array(); }
			};
			$this->api->update( $this->action( 'choice', 'empty-cart', array( 'checked' => true ) ) );
			self::assertSame( 'capture_observe_cart_empty', $this->api->data()['reason'] );
			self::assertCount( 2, $this->events );
		} finally {
			WC()->cart = $cart;
		}
	}

	public function test_store_api_input_rejections_use_distinct_codes(): void {
		$codes = array();
		$this->api->update( $this->action( 'unknown' ) );
		$codes[] = $this->api->data()['reason'];
		$this->api->update( $this->action( 'choice', 'invalid-country', array( 'expectedCountry' => 'GBR' ) ) );
		$codes[] = $this->api->data()['reason'];
		$this->api->update( $this->action( 'choice', 'invalid-selection', array( 'checked' => 'yes' ) ) );
		$codes[] = $this->api->data()['reason'];
		$this->api->update( $this->action( 'choice', 'invalid-phone-type', array( 'expectedPhone' => 123 ) ) );
		$codes[] = $this->api->data()['reason'];
		self::assertSame( array( 'store_api_action_invalid', 'store_api_expected_country_invalid',
			'store_api_choice_value_invalid', 'store_api_expected_phone_invalid' ), $codes );
		self::assertSame( count( $codes ), count( array_unique( $codes ) ) );
		self::assertCount( 0, $this->events );
	}

	public function test_explicit_withdraw_requires_confirmation_and_current_verified_proof(): void {
		$this->api->update( $this->action( 'choice', 'm-no-grant', array( 'checked' => false ) ) );
		self::assertSame( 'store_api_choice_value_invalid', $this->api->data()['reason'] );
		$this->api->update( $this->action( 'withdraw', 'm-unverified', array( 'confirmed' => true ) ) );
		self::assertSame( 'capture_withdraw_proof_unavailable', $this->api->data()['reason'] );
		self::assertCount( 0, $this->events );
		$this->api->update( $this->action( 'choice', 'm-g', array( 'checked' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		WC()->session->set( 'moda_interact_checkout_consent_observation_v2', null );
		$this->api->update( $this->action( 'status', 'm-confirm-existing' ) );
		self::assertTrue( $this->api->data()['confirmed'] );
		$this->api->update( $this->action( 'withdraw', 'm-w2' ) );
		self::assertSame( 'store_api_withdraw_confirmation_missing', $this->api->data()['reason'] );
		self::assertCount( 1, $this->events );
		$this->api->update( $this->action( 'withdraw', 'm-w2', array( 'confirmed' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertSame( 'REVOKE', end( $this->events )['decision'] );
		$this->api->update( $this->action( 'withdraw', 'm-w2', array( 'confirmed' => true ) ) );
		self::assertSame( 'recorded', $this->api->data()['status'] );
		self::assertCount( 2, $this->events, 'Retry of confirmed withdrawal is idempotent' );
		$this->api->update( $this->action( 'status', 'm-after-revoke' ) );
		self::assertFalse( $this->api->data()['confirmed'] );
	}
}
