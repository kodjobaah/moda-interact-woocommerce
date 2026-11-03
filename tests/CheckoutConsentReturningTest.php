<?php

/** ARCH-046-WOOCOMMERCE-003 v2-only returning-consent and fail-closed proof tests. */

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentActions;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCheckbox;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentEligibility;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentProof;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentStatusReader;
use ModaInteract\WooCommerce\Checkout\CheckoutKey;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fixtures/Arch046CheckoutTestFakes.php';

final class CheckoutConsentReturningTest extends TestCase {
	private array $requests = array();
	private CheckoutConsentCapture $capture;
	private CheckoutConsentPublisher $publisher;
	private CheckoutConsentProof $proof;
	private CheckoutConsentEligibility $eligibility;
	private bool $feature = true;
	private int $featureReads = 0;
	private bool $unavailable = false;

	protected function setUp(): void {
		$GLOBALS['arch046_nonce_action'] = 'update-order-review';
		$GLOBALS['arch046_current_user_id'] = 0;
		$GLOBALS['arch046_user_meta'] = array();
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
		$this->featureReads = 0;
		$this->unavailable = false;
		$transport = function ( string $url, array $request ) {
			$path = parse_url( $url, PHP_URL_PATH );
			if ( '/v1/merchant/feature-preferences' === $path ) {
				++$this->featureReads;
				return $this->response( 200, array( 'schemaVersion' => 1, 'revision' => str_repeat( 'a', 64 ),
					'features' => array( array( 'id' => 'feature-1', 'key' => 'checkout_recovery',
					'name' => 'Checkout Recovery', 'description' => null,
					'enabled' => true, 'effective' => $this->feature,
					'editable' => false, 'required' => true, 'planEligible' => true ) ) ) );
			}
			$this->requests[] = array( $url, $request );
			if ( $this->unavailable ) return $this->response( 503, array( 'error' => 'unavailable' ) );
			$event = json_decode( $request['body'], true );
			return $this->response( 200, array( 'schemaVersion' => 'woo.whatsapp-consent.v2',
				'status' => 'recorded', 'decision' => $event['decision'],
				'consentRevision' => (string) count( $this->requests ),
				'decisionSequence' => (string) count( $this->requests ) ) );
		};
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport );
		$site = new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn( string $host ) => array( '93.184.216.34' ) );
		$this->publisher = new CheckoutConsentPublisher( $client, new InstallationStore(), $site );
		$this->eligibility = new CheckoutConsentEligibility( new InstallationStore() );
		$this->proof = new CheckoutConsentProof();
		$this->capture = new CheckoutConsentCapture( $this->publisher, $this->eligibility, $this->proof );
	}

	protected function tearDown(): void {
		unset( $GLOBALS['arch046_nonce_action'], $GLOBALS['arch046_current_user_id'] );
	}

	private function response( int $status, array $payload ): array {
		return array( 'response' => array( 'code' => $status ),
			'headers' => array( 'content-type' => 'application/json' ), 'body' => json_encode( $payload ) );
	}

	private function classic( bool $checked, string $phone = '+447400123456',
		bool $legacyWithdraw = false, bool $explicitUncheck = false, bool $explicitGrant = true ): void {
		$_POST['security'] = 'arch046-fixture-nonce';
		$this->capture->classicReview( 'billing_phone=' . rawurlencode( $phone ) . '&billing_country=GB' .
			( $checked ? '&' . CheckoutConsentCheckbox::CLASSIC_FIELD . '=1' : '' ) .
			( $checked && $explicitGrant ? '&moda_interact_whatsapp_recovery_checked_action=1' : '' ) .
			( $legacyWithdraw ? '&moda_interact_whatsapp_recovery_withdrawal=withdraw' : '' ) .
			( $explicitUncheck ? '&moda_interact_whatsapp_recovery_unchecked_action=1' : '' ) );
	}

	private function enableConfirmedStatus(): void {
		$this->capture = new CheckoutConsentCapture( $this->publisher, $this->eligibility,
			$this->proof, new CheckoutConsentStatusReader( static fn( array $proof ): string => 'CONFIRMED_GRANTED' ) );
	}

	private function event( int $index ): array {
		return json_decode( $this->requests[$index][1]['body'], true );
	}

	public function test_v2_only_exact_payload_and_neutral_unchecked_refresh(): void {
		$this->classic( false );
		$this->classic( false, '+447400123456', true );
		self::assertCount( 0, $this->requests, 'Legacy dropdown is inert' );
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$event = $this->event( 0 );
		self::assertSame( array( 'schemaVersion', 'eventId', 'decision', 'canonicalPhone', 'occurredAt', 'disclosure' ), array_keys( $event ) );
		self::assertSame( 'woo.whatsapp-consent.v2', $event['schemaVersion'] );
		self::assertSame( 'GRANT', $event['decision'] );
		self::assertSame( array( 'version', 'locale', 'text' ), array_keys( $event['disclosure'] ) );
		$this->classic( false, '+447400123456', true );
		$this->classic( false );
		self::assertCount( 1, $this->requests, 'Unchecked refresh and forged old select are neutral' );
		self::assertNotNull( $this->proof->forCurrentShopper( $event['canonicalPhone'] ) );
	}

	public function test_proof_is_retained_only_after_hosted_ack_and_retried_with_original_id(): void {
		$this->unavailable = true;
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		self::assertNull( $this->proof->forCurrentShopper( '447400123456' ) );
		$this->unavailable = false;
		$this->classic( true );
		self::assertCount( 2, $this->requests );
		self::assertSame( $this->requests[0][1]['body'], $this->requests[1][1]['body'] );
		self::assertSame( $this->event( 0 )['eventId'],
			$this->proof->forCurrentShopper( '447400123456' )['grantEventId'] );
	}

	public function test_explicit_uncheck_supersedes_unacknowledged_grant_with_retryable_revoke(): void {
		$this->unavailable = true;
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$grant = $this->event( 0 );
		$lease_key = 'moda_woo_consent_retry_' . hash( 'sha256', $grant['eventId'] );
		self::assertIsArray( get_transient( $lease_key ) );
		self::assertNull( $this->proof->forCurrentShopper( $grant['canonicalPhone'] ) );

		// HTTP 503 does not prove the GRANT was never committed. This shopper's
		// same-checkout uncheck must supersede its retry and attempt a REVOKE,
		// even when the API-006 status reader is absent.
		self::assertFalse( $this->capture->withdrawExplicit( 'CLASSIC', '+447400123456', 'GB', true ) );
		self::assertSame( 'capture_observe_revoke_publish_unacknowledged', $this->capture->failureReason() );
		self::assertFalse( get_transient( $lease_key ) );
		self::assertCount( 2, $this->requests );
		$revoke = $this->event( 1 );
		self::assertSame( 'REVOKE', $revoke['decision'] );
		self::assertNotSame( $grant['eventId'], $revoke['eventId'] );
		$state = WC()->session->get( 'moda_interact_checkout_consent_observation_v2' );
		self::assertSame( 'REVOKE', $state['pending']['decision'] );
		self::assertFalse( $state['checked'] );

		$this->unavailable = false;
		$this->publisher->deliver( $grant, 'installation-a', 'shop-a', 2 );
		self::assertCount( 2, $this->requests, 'Cancelled background retry cannot publish an obsolete GRANT' );
		self::assertTrue( $this->capture->withdrawExplicit( 'CLASSIC', '+447400123456', 'GB', true ) );
		self::assertCount( 3, $this->requests );
		self::assertSame( $revoke['eventId'], $this->event( 2 )['eventId'],
			'Lost REVOKE ACK retries the same event identity' );
		self::assertNull( $this->proof->forCurrentShopper( $grant['canonicalPhone'] ) );

		$this->classic( true );
		self::assertCount( 4, $this->requests );
		self::assertSame( 'GRANT', $this->event( 3 )['decision'] );
		self::assertNotSame( $grant['eventId'], $this->event( 3 )['eventId'] );
	}

	public function test_uncheck_with_different_phone_cannot_cancel_original_grant_retry(): void {
		$this->unavailable = true;
		$this->classic( true );
		$grant = $this->event( 0 );
		$lease_key = 'moda_woo_consent_retry_' . hash( 'sha256', $grant['eventId'] );
		self::assertIsArray( get_transient( $lease_key ) );
		self::assertFalse( $this->capture->withdrawExplicit( 'CLASSIC', '+447400123457', 'GB', true ) );
		self::assertSame( 'capture_withdraw_context_mismatch', $this->capture->failureReason() );
		self::assertIsArray( get_transient( $lease_key ), 'Wrong-contact request must not change the retry lease' );
		self::assertCount( 1, $this->requests );
	}

	public function test_guest_proof_cannot_cross_phone_checkout_or_account_boundary(): void {
		$this->classic( true );
		self::assertNotNull( $this->proof->forCurrentShopper( '447400123456' ) );
		self::assertNull( $this->proof->forCurrentShopper( '447400123457' ) );
		$GLOBALS['arch046_woo']->session->set( 'customer_id', 'another-guest-session' );
		self::assertNull( $this->proof->forCurrentShopper( '447400123456' ) );
		$GLOBALS['arch046_woo']->session->set( 'customer_id', 'guest-session-1' );
		$GLOBALS['arch046_current_user_id'] = 24;
		self::assertNull( $this->proof->forCurrentShopper( '447400123456' ) );
	}

	public function test_account_bound_proof_survives_checkout_but_not_another_account_or_installation(): void {
		$GLOBALS['arch046_current_user_id'] = 42;
		$this->classic( true );
		self::assertNotNull( $this->proof->forCurrentShopper( '447400123456' ) );
		$this->capture->endCheckout();
		self::assertNotNull( $this->proof->forCurrentShopper( '447400123456' ) );
		$GLOBALS['arch046_current_user_id'] = 43;
		self::assertNull( $this->proof->forCurrentShopper( '447400123456' ) );
		$GLOBALS['arch046_current_user_id'] = 42;
		$record = ( new InstallationStore() )->read()['record'];
		$record['credentialVersion']++;
		( new InstallationStore() )->save( $record );
		self::assertNull( $this->proof->forCurrentShopper( '447400123456' ) );
	}

	public function test_same_checkout_withdraw_does_not_depend_on_remote_status(): void {
		$this->classic( true );
		$this->classic( false ); // Routine checkout refresh is not a withdrawal.
		self::assertCount( 1, $this->requests );
		// Default status reader cannot reach API-006 in this fixture; it must not
		// be invoked for the same shopper's explicit reversal of this GRANT.
		self::assertTrue( $this->capture->withdrawExplicit( 'CLASSIC', '+447400123456', 'GB', true ) );
		self::assertCount( 2, $this->requests );
		$event = $this->event( 1 );
		self::assertSame( 'REVOKE', $event['decision'] );
		self::assertNull( $event['disclosure'] );
		self::assertNull( $this->proof->forCurrentShopper( '447400123456' ) );
		self::assertFalse( $this->capture->withdrawExplicit( 'CLASSIC', '+447400123456', 'GB', true ) );
		self::assertCount( 2, $this->requests );
	}

	public function test_returning_account_proof_still_needs_current_status_confirmation(): void {
		$GLOBALS['arch046_current_user_id'] = 42;
		$this->classic( true );
		$this->capture->endCheckout();
		$GLOBALS['arch046_woo']->session = new Arch046Session();
		self::assertFalse( $this->capture->withdrawExplicit( 'CLASSIC', '+447400123456', 'GB', true ) );
		self::assertSame( 'capture_withdraw_status_unconfirmed', $this->capture->failureReason() );
		self::assertCount( 1, $this->requests, 'Stale proof must not revoke without hosted confirmation' );
		$this->enableConfirmedStatus();
		self::assertTrue( $this->capture->withdrawExplicit( 'CLASSIC', '+447400123456', 'GB', true ) );
		self::assertSame( 'REVOKE', $this->event( 1 )['decision'] );
	}

	public function test_native_woo_ajax_action_requires_nonce_confirmation_and_server_proof(): void {
		$this->classic( true );
		$this->classic( false );
		$this->enableConfirmedStatus();
		$actions = new CheckoutConsentActions( $this->capture );
		$actions->register();
		self::assertNotEmpty( $GLOBALS['moda_interact_test_hooks']['wc_ajax_moda_interact_checkout_consent_status'] ?? array() );
		self::assertNotEmpty( $GLOBALS['moda_interact_test_hooks']['wc_ajax_moda_interact_checkout_consent_withdraw'] ?? array() );
		self::assertArrayNotHasKey( 'moda-interact/v1/checkout-consent/withdraw', $GLOBALS['moda_interact_registered_rest_routes'] );
		unset( $GLOBALS['arch046_nonce_action'] );
		$make = static function ( string $nonce, bool $confirmed ) {
			return new class( $nonce, $confirmed ) {
				public function __construct( private string $nonce, private bool $confirmed ) {}
				public function get_method(): string { return 'POST'; }
				public function get_header( $header ): ?string {
					return 'x-wp-nonce' === strtolower( $header ) ? $this->nonce : null;
				}
				public function get_json_params(): array {
					return array( 'mode' => 'CLASSIC', 'confirmed' => $this->confirmed,
						'form' => 'billing_phone=%2B447400123456&billing_country=GB' );
				}
			};
		};
		self::assertFalse( $actions->permitted( $make( 'invalid', true ) ) );
		self::assertSame( 'unverified', $actions->withdraw( $make( 'fixture_rest_nonce', false ) )['status'] );
		self::assertCount( 1, $this->requests );
		self::assertSame( 'withdrawn', $actions->withdraw( $make( 'fixture_rest_nonce', true ) )['status'] );
		self::assertCount( 2, $this->requests );
	}

	public function test_native_classic_ajax_enforces_nonce_method_and_existing_session(): void {
		$this->classic( true );
		$this->enableConfirmedStatus();
		$actions = new CheckoutConsentActions( $this->capture );
		$original_post = $_POST;
		$original_method = $_SERVER['REQUEST_METHOD'] ?? null;
		$session = WC()->session;
		unset( $GLOBALS['arch046_nonce_action'] );
		$_SERVER['REQUEST_METHOD'] = 'POST';
		$_POST = array(
			'security' => 'fixture_rest_nonce',
			'mode' => 'CLASSIC',
			'form' => 'billing_phone=%2B447400123456&billing_country=GB',
			'confirmed' => '0',
		);
		try {
			$actions->ajaxStatus();
			self::assertSame( 200, $GLOBALS['arch046_last_ajax_json']['code'] );
			self::assertSame( array( 'confirmed' => true, 'reason' => '' ),
				$GLOBALS['arch046_last_ajax_json']['body'] );
			$_POST['security'] = 'invalid';
			$_POST['confirmed'] = '1';
			$actions->ajaxWithdraw();
			self::assertSame( 403, $GLOBALS['arch046_last_ajax_json']['code'] );
			self::assertSame( 'unverified', $GLOBALS['arch046_last_ajax_json']['body']['status'] );
			self::assertCount( 1, $this->requests, 'A forged nonce cannot publish REVOKE' );
			$_POST['security'] = 'fixture_rest_nonce';
			$_POST['mode'] = 'BLOCKS';
			$actions->ajaxWithdraw();
			self::assertSame( 'unverified', $GLOBALS['arch046_last_ajax_json']['body']['status'] );
			self::assertCount( 1, $this->requests, 'Classic route cannot impersonate the Blocks consent path' );
			$_POST['mode'] = 'CLASSIC';
			$_SERVER['REQUEST_METHOD'] = 'GET';
			$actions->ajaxWithdraw();
			self::assertSame( 403, $GLOBALS['arch046_last_ajax_json']['code'] );
			$_SERVER['REQUEST_METHOD'] = 'POST';
			WC()->session = null;
			$actions->ajaxWithdraw();
			self::assertSame( 403, $GLOBALS['arch046_last_ajax_json']['code'] );
			self::assertCount( 1, $this->requests );
			WC()->session = $session;
			$_POST['confirmed'] = '0';
			$actions->ajaxWithdraw();
			self::assertSame( 200, $GLOBALS['arch046_last_ajax_json']['code'] );
			self::assertSame( 'unverified', $GLOBALS['arch046_last_ajax_json']['body']['status'] );
			$_POST['confirmed'] = '1';
			$actions->ajaxWithdraw();
			self::assertSame( 200, $GLOBALS['arch046_last_ajax_json']['code'] );
			self::assertSame( 'withdrawn', $GLOBALS['arch046_last_ajax_json']['body']['status'] );
			self::assertCount( 2, $this->requests );
		} finally {
			WC()->session = $session;
			$_POST = $original_post;
			if ( null === $original_method ) {
				unset( $_SERVER['REQUEST_METHOD'] );
			} else {
				$_SERVER['REQUEST_METHOD'] = $original_method;
			}
			unset( $GLOBALS['arch046_last_ajax_json'] );
		}
	}

	public function test_native_field_cannot_authorise_permission_but_explicit_blocks_action_can(): void {
		self::assertTrue( $this->capture->observe( 'BLOCKS', true,
			'+447400123456', 'GB', true, false, 'explicit-request-1' ) );
		self::assertCount( 1, $this->requests );
		// A fresh same-checkout uncheck does not need API-006.
		self::assertTrue( $this->capture->withdrawExplicit( 'BLOCKS', '+447400123456', 'GB', true,
			'explicit-request-2' ) );
		self::assertCount( 2, $this->requests );
		self::assertSame( 'REVOKE', $this->event( 1 )['decision'] );
	}

	public function test_account_proof_withdrawal_on_later_checkout_does_not_need_previous_checkbox_observation(): void {
		$GLOBALS['arch046_current_user_id'] = 42;
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$this->capture->endCheckout();
		// A later authenticated account checkout has a different Woo session.
		$GLOBALS['arch046_woo']->session = new Arch046Session();
		$this->enableConfirmedStatus();
		self::assertTrue( $this->capture->hasConfirmedPermission( '+447400123456', 'GB' ) );
		self::assertTrue( $this->capture->withdrawExplicit( 'CLASSIC', '+447400123456', 'GB', true ) );
		self::assertCount( 2, $this->requests );
		self::assertSame( 'REVOKE', $this->event( 1 )['decision'] );
		self::assertNull( $this->proof->forCurrentShopper( '447400123456' ) );
	}

	public function test_proof_and_remote_diagnostics_preserve_fail_closed_authority(): void {
		$missing = $this->capture->permissionStatus( '+447400123456', 'GB' );
		self::assertSame( array( 'confirmed' => false, 'reason' => 'consent_proof_missing' ), $missing );
		$this->classic( true );
		$proof = $this->proof->inspectForCurrentShopper( '447400123456' );
		self::assertSame( '', $proof['reason'] );
		self::assertArrayHasKey( 'grantEventId', $proof['proof'] );
		self::assertSame( array( 'confirmed' => false, 'reason' => 'consent_status_remote_unverified' ),
			( new CheckoutConsentStatusReader( static fn( array $p ): string => 'UNVERIFIED' ) )->inspect( $proof['proof'] ) );
		self::assertSame( array( 'confirmed' => false, 'reason' => 'consent_status_remote_unavailable' ),
			( new CheckoutConsentStatusReader( static function (): string {
				throw new \RuntimeException( 'no sensitive exception text in response' );
			} ) )->inspect( $proof['proof'] ) );
		self::assertSame( array( 'confirmed' => true, 'reason' => '' ),
			( new CheckoutConsentStatusReader( static fn( array $p ): string => 'CONFIRMED_GRANTED' ) )->inspect( $proof['proof'] ) );
		self::assertSame( 'consent_proof_phone_mismatch',
			$this->proof->inspectForCurrentShopper( '447400123457' )['reason'] );
		$GLOBALS['arch046_woo']->session->set( 'customer_id', 'new-guest-principal' );
		self::assertSame( 'consent_proof_checkout_mismatch',
			$this->proof->inspectForCurrentShopper( '447400123456' )['reason'] );
		// Proof diagnostics must never leak the capability to the browser.
		self::assertArrayNotHasKey( 'grantEventId', $missing );
		self::assertCount( 1, $this->requests, 'Status/proof reads never publish another event' );
	}

	public function test_api006_status_client_uses_authenticated_body_only_proof_and_rejects_bad_response(): void {
		$requests = array();
		$transport = static function ( string $url, array $request ) use ( &$requests ) {
			$requests[] = array( $url, $request );
			return array( 'response' => array( 'code' => 200 ),
				'headers' => array( 'content-type' => 'application/json' ),
				'body' => json_encode( array( 'schemaVersion' => 'woo.whatsapp-consent-status.v1',
					'state' => 'CONFIRMED_GRANTED' ) ) );
		};
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport );
		$proof = array( 'grantEventId' => 'woo-consent-example', 'canonicalPhone' => '447400123456' );
		$record = ( new InstallationStore() )->read()['record'];
		self::assertSame( 'CONFIRMED_GRANTED', $client->wooConsentStatus( $record, $proof ) );
		self::assertCount( 1, $requests );
		self::assertStringEndsWith( '/v1/woocommerce/whatsapp-consent/status', $requests[0][0] );
		self::assertStringNotContainsString( 'woo-consent-example', $requests[0][0] );
		self::assertSame( array( 'schemaVersion', 'canonicalPhone', 'grantEventId' ),
			array_keys( json_decode( $requests[0][1]['body'], true ) ) );
		self::assertArrayHasKey( 'Authorization', $requests[0][1]['headers'] );
		self::assertSame( 'no-store', $requests[0][1]['headers']['Cache-Control'] );
	}

	public function test_shop_checkout_status_route_discloses_no_proof_or_phone(): void {
		$this->classic( true );
		$this->enableConfirmedStatus();
		$actions = new CheckoutConsentActions( $this->capture );
		unset( $GLOBALS['arch046_nonce_action'] );
		$request = new class {
			public function get_method(): string { return 'POST'; }
			public function get_header( $header ): ?string {
				return strtolower( $header ) === 'x-wp-nonce' ? 'fixture_rest_nonce' : null;
			}
			public function get_json_params(): array { return array( 'mode' => 'CLASSIC',
				'form' => 'billing_phone=%2B447400123456&billing_country=GB' ); }
		};
		self::assertSame( array( 'confirmed' => true, 'reason' => '' ), $actions->status( $request ) );
		self::assertCount( 1, $this->requests, 'Reading must not write new consent evidence' );
		$this->proof->clearCurrent();
		self::assertSame( array( 'confirmed' => false, 'reason' => 'consent_proof_missing' ), $actions->status( $request ) );
	}

	public function test_native_ajax_permission_never_initializes_or_creates_checkout_state(): void {
		unset( $GLOBALS['arch046_nonce_action'] );
		$session = WC()->session;
		$GLOBALS['arch046_lazy_checkout_session'] = $session;
		$GLOBALS['arch046_wc_load_cart_calls'] = 0;
		$actions = new CheckoutConsentActions( $this->capture );
		$request = static function ( string $nonce ) {
			return new class( $nonce ) {
				public function __construct( private string $nonce ) {}
				public function get_method(): string { return 'POST'; }
				public function get_header( $name ): ?string {
					return 'x-wp-nonce' === strtolower( $name ) ? $this->nonce : null;
				}
			};
		};
		try {
			$session->set( CheckoutKey::SESSION_FIELD, null );
			self::assertFalse( $actions->permitted( $request( 'invalid' ) ) );
			self::assertTrue( $actions->permitted( $request( 'fixture_rest_nonce' ) ) );
			self::assertNull( $session->get( CheckoutKey::SESSION_FIELD ),
				'Permission validation must not allocate a Moda checkout key' );
			WC()->session = null;
			self::assertFalse( $actions->permitted( $request( 'fixture_rest_nonce' ) ),
				'Missing Woo session must fail closed rather than initialize merchant state' );
			self::assertNull( WC()->session );
			self::assertSame( 0, $GLOBALS['arch046_wc_load_cart_calls'],
				'Even valid requests cannot call wc_load_cart' );
		} finally {
			WC()->session = $session;
			unset( $GLOBALS['arch046_lazy_checkout_session'], $GLOBALS['arch046_wc_load_cart_calls'] );
		}
	}

	public function test_status_read_cannot_generate_new_checkout_key(): void {
		$this->classic( true );
		$session = WC()->session;
		self::assertNotNull( $session->get( CheckoutKey::SESSION_FIELD ) );
		$session->set( CheckoutKey::SESSION_FIELD, null );
		unset( $GLOBALS['arch046_nonce_action'] );
		$actions = new CheckoutConsentActions( $this->capture );
		$request = new class {
			public function get_method(): string { return 'POST'; }
			public function get_header( $header ): ?string {
				return 'x-wp-nonce' === strtolower( $header ) ? 'fixture_rest_nonce' : null;
			}
			public function get_json_params(): array { return array( 'mode' => 'BLOCKS' ); }
		};
		self::assertSame( array( 'confirmed' => false, 'reason' => 'consent_proof_checkout_mismatch' ), $actions->status( $request ) );
		self::assertNull( $session->get( CheckoutKey::SESSION_FIELD ) );
		self::assertCount( 1, $this->requests, 'Status read does not publish an event' );
	}

	public function test_choice_reports_unavailable_checkout_objects_without_bootstrapping_them(): void {
		unset( $GLOBALS['arch046_nonce_action'] );
		$actions = new CheckoutConsentActions( $this->capture );
		$request = new class {
			public function get_method(): string { return 'POST'; }
			public function get_header( $header ): ?string {
				return match ( strtolower( $header ) ) {
					'x-wp-nonce' => 'fixture_rest_nonce',
					'x-wc-store-api-nonce' => 'fixture_store_nonce',
					default => null,
				};
			}
			public function get_json_params(): array { return array( 'mode' => 'BLOCKS', 'checked' => true ); }
		};
		$cart = WC()->cart;
		$customer = WC()->customer;
		$GLOBALS['arch046_wc_load_cart_calls'] = 0;
		try {
			WC()->customer = null;
			self::assertSame( array( 'status' => 'unverified', 'reason' => 'billing_contact_unavailable' ),
				$actions->choice( $request ) );
			self::assertNull( WC()->customer );
			WC()->customer = $customer;
			WC()->cart = null;
			self::assertSame( array( 'status' => 'unverified', 'reason' => 'capture_observe_cart_unavailable' ),
				$actions->choice( $request ) );
			self::assertNull( WC()->cart );
			WC()->cart = new class {
				public function get_cart(): array { return array(); }
			};
			self::assertSame( array( 'status' => 'unverified', 'reason' => 'capture_observe_cart_empty' ),
				$actions->choice( $request ) );
			self::assertCount( 0, $this->requests );
			self::assertSame( 0, $GLOBALS['arch046_wc_load_cart_calls'] );
		} finally {
			WC()->cart = $cart;
			WC()->customer = $customer;
			unset( $GLOBALS['arch046_wc_load_cart_calls'] );
		}
		self::assertSame( 'recorded', $actions->choice( $request )['status'],
			'Valid checkout objects still record explicit consent' );
		self::assertCount( 1, $this->requests );
	}

	public function test_blocks_slotfill_choice_requires_both_rest_and_store_nonces(): void {
		unset( $GLOBALS['arch046_nonce_action'] );
		$actions = new CheckoutConsentActions( $this->capture );
		$make = static function ( string $nonce ) {
			return new class( $nonce ) {
				public function __construct( private string $nonce ) {}
				public function get_method(): string { return 'POST'; }
				public function get_header( $header ): ?string {
					return match ( strtolower( $header ) ) {
						'x-wp-nonce' => 'fixture_rest_nonce',
						'x-wc-store-api-nonce' => $this->nonce,
						default => null,
					};
				}
				public function get_json_params(): array {
					return array( 'mode' => 'BLOCKS', 'checked' => true );
				}
			};
		};
		self::assertSame( 'unverified', $actions->choice( $make( 'invalid' ) )['status'] );
		self::assertCount( 0, $this->requests );
		self::assertSame( 'recorded', $actions->choice( $make( 'fixture_store_nonce' ) )['status'] );
		self::assertCount( 1, $this->requests );
		self::assertSame( 'GRANT', $this->event( 0 )['decision'] );
	}

	public function test_customer_can_withdraw_existing_permission_after_feature_is_disabled(): void {
		$GLOBALS['arch046_current_user_id'] = 42;
		$this->classic( true );
		$this->capture->endCheckout();
		$GLOBALS['arch046_woo']->session = new Arch046Session();
		$this->feature = false;
		$this->enableConfirmedStatus();
		self::assertTrue( $this->capture->withdrawExplicit( 'CLASSIC', '+447400123456', 'GB', true ) );
		self::assertSame( 'REVOKE', $this->event( 1 )['decision'] );
		self::assertSame( 0, $this->featureReads, 'Consent grant and withdrawal never fetch feature preferences' );
	}

}
