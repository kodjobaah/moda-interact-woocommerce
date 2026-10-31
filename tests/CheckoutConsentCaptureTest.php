<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCheckbox;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentEligibility;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutKey;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fixtures/Arch046CheckoutTestFakes.php';

final class CheckoutConsentCaptureTest extends TestCase {
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
		$GLOBALS['moda_interact_options'] = array( 'blogname' => 'Test Merchant', 'WPLANG' => 'en_GB' );
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
			return $this->response( 200, array( 'schemaVersion' => 'woo.whatsapp-consent.v2',
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

	private function classic( bool $checked, string $phone = '+447400123456',
		string $nonce = 'arch046-fixture-nonce', bool $explicit_uncheck = false,
		bool $explicit_grant = true ): void {
		$_POST['security'] = $nonce;
		$this->capture->classicReview( 'billing_phone=' . rawurlencode( $phone ) . '&billing_country=GB' .
			( $checked ? '&' . CheckoutConsentCheckbox::CLASSIC_FIELD . '=1' : '' ) .
			( $checked && $explicit_grant ? '&moda_interact_whatsapp_recovery_checked_action=1' : '' ) .
			( $explicit_uncheck ? '&moda_interact_whatsapp_recovery_unchecked_action=1' : '' ) );
	}

	public function test_classic_preselected_field_or_refresh_does_not_create_grant(): void {
		// The frontend may precheck the native field after an API-006 read.
		// A normal Woo update_order_review callback must not re-grant it.
		$this->classic( true, '+447400123456', 'arch046-fixture-nonce', false, false );
		self::assertCount( 0, $this->requests );
		$this->classic( true );
		self::assertCount( 1, $this->requests, 'Only the explicit change marker permits GRANT' );
	}

	public function test_explicit_classic_transition_mints_once_and_unchecked_default_does_not_grant(): void {
		$this->capture->register();
		$this->classic( false );
		self::assertCount( 0, $this->requests );
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$first = json_decode( $this->requests[0][1]['body'], true );
		self::assertSame( 'GRANT', $first['decision'] );
		self::assertSame( '447400123456', $first['canonicalPhone'] );
		self::assertSame( array( 'schemaVersion', 'eventId', 'decision', 'canonicalPhone', 'occurredAt', 'disclosure' ), array_keys( $first ) );
		self::assertSame( 'woo.whatsapp-consent.v2', $first['schemaVersion'] );
		self::assertSame( 'moda.woo.whatsapp-recovery-marketing.v3', $first['disclosure']['version'] );
		self::assertSame( array( 'version', 'locale', 'text' ), array_keys( $first['disclosure'] ) );
		self::assertSame( 'Send me WhatsApp shopping updates, reminders and offers.', $first['disclosure']['text'] );
		self::assertStringNotContainsString( 'https://merchant.example', $first['disclosure']['text'] );
		self::assertStringNotContainsString( 'Test Merchant', $first['disclosure']['text'] );
		self::assertSame( 'en-GB', $first['disclosure']['locale'] );
		self::assertSame( 'Bearer ' . ( new InstallationStore() )->read()['record']['credential'], $this->requests[0][1]['headers']['Authorization'] );
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$this->classic( false );
		self::assertCount( 1, $this->requests, 'Ordinary refresh without the checkbox is neutral' );
		$this->classic( false, '+447400123456', 'arch046-fixture-nonce', true );
		self::assertCount( 1, $this->requests, 'Legacy uncheck marker cannot REVOKE' );
		$this->classic( false, '+447400123456', 'arch046-fixture-nonce', true );
		self::assertCount( 1, $this->requests, 'A repeated uncheck is still neutral' );
		$this->classic( true );
		self::assertCount( 1, $this->requests, 'A repeated checked state cannot send a duplicate GRANT' );

	}

	public function test_bad_nonce_disabled_feature_and_cross_checkout_phone_do_not_grant(): void {
		$this->classic( true, '+447400123456', 'forged' );
		self::assertCount( 0, $this->requests );
		$this->feature = false;
		$this->classic( true );
		self::assertCount( 0, $this->requests );
		$this->feature = true;
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$this->classic( true, '+447400123457' );
		self::assertCount( 1, $this->requests, 'New phone must not inherit an existing check' );
		$this->classic( false, '+447400123457' );
		$this->classic( true, '+447400123457' );
		self::assertCount( 2, $this->requests );
	}

	public function test_native_checkout_field_changes_cannot_create_consent_hooks(): void {
		// CheckoutCapture legitimately listens for checkout drafts. The consent
		// registration must not attach any *additional* consent callbacks to
		// ordinary Woo field or customer update hooks.
		$before = $GLOBALS['moda_interact_test_hooks'];
		$this->capture->register();
		$after = $GLOBALS['moda_interact_test_hooks'];
		foreach ( array(
			'woocommerce_store_api_checkout_update_draft',
			'woocommerce_store_api_checkout_update_order_from_request',
			'woocommerce_store_api_checkout_update_customer_from_request',
			'woocommerce_store_api_cart_update_customer_from_request',
		) as $hook ) {
			self::assertSame( $before[ $hook ] ?? array(), $after[ $hook ] ?? array(),
				'Consent must not add callbacks to ordinary Woo field writes' );
		}
		self::assertCount( 0, $this->requests );
	}

	public function test_action_scheduler_retry_keeps_event_identity_and_cannot_reuse_revoked_installation(): void {
		$this->unavailable = true;
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		self::assertNotEmpty( $GLOBALS['arch035_delayed'] );
		$args = $GLOBALS['arch035_delayed'][0]['args'];
		$this->unavailable = false;
		$this->publisher->deliver( ...array_values( $args ) );
		self::assertCount( 2, $this->requests );
		self::assertSame( $this->requests[0][1]['body'], $this->requests[1][1]['body'] );
		$rotated = ( new InstallationStore() )->read()['record'];
		$rotated['installationId'] = 'replacement-installation';
		( new InstallationStore() )->save( $rotated );
		$this->publisher->deliver( ...array_values( $args ) );
		self::assertCount( 2, $this->requests, 'Stale installation cannot retry' );
	}

	public function test_lost_ack_retries_the_same_event_and_outage_does_not_block(): void {
		$this->unavailable = true;
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		self::assertNotEmpty( $GLOBALS['arch046_woo']->session->get( 'moda_interact_checkout_consent_observation_v2' )['pending'] );
		$event = json_decode( $this->requests[0][1]['body'], true );
		$this->unavailable = false;
		$this->classic( true );
		self::assertCount( 2, $this->requests );
		self::assertSame( $event, json_decode( $this->requests[1][1]['body'], true ) );
		self::assertCount( 0, $GLOBALS['moda_interact_external_requests'], 'No checkout/Meta/billing side effect' );
	}

	public function test_classic_uncheck_requires_verified_checkout_and_matching_phone(): void {
		$this->classic( false, '+447400123456', 'arch046-fixture-nonce', true );
		self::assertCount( 0, $this->requests, 'A fresh checkout never sends REVOKE' );
		$this->classic( true );
		$this->classic( false, '+447400123456', 'forged', true );
		self::assertCount( 1, $this->requests, 'A forged nonce cannot revoke' );
		$this->classic( false, '+447400123457', 'arch046-fixture-nonce', true );
		self::assertCount( 1, $this->requests, 'A changed phone cannot inherit the old check' );
		$this->classic( false, '+447400123457', 'arch046-fixture-nonce', true );
		self::assertCount( 1, $this->requests );
	}

	public function test_uncheck_does_not_revoke_or_cancel_unacknowledged_grant(): void {
		$this->unavailable = true;
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$first = json_decode( $this->requests[0][1]['body'], true );
		self::assertSame( 'GRANT', $first['decision'] );
		self::assertNotEmpty( $GLOBALS['arch035_delayed'] );
		$retry = $GLOBALS['arch035_delayed'][0]['args'];
		$this->unavailable = false;
		$this->classic( false, '+447400123456', 'arch046-fixture-nonce', true );
		self::assertCount( 1, $this->requests, 'An uncheck is not a withdrawal instruction' );
		$this->publisher->deliver( ...array_values( $retry ) );
		self::assertCount( 2, $this->requests, 'The original grant retry keeps its event identity' );
		self::assertSame( $this->requests[0][1]['body'], $this->requests[1][1]['body'] );
	}

	public function test_failed_and_repeated_uncheck_cannot_publish_revoke(): void {
		$this->classic( true );
		$this->unavailable = true;
		$this->classic( false, '+447400123456', 'arch046-fixture-nonce', true );
		self::assertCount( 1, $this->requests );
		$this->unavailable = false;
		$this->classic( false, '+447400123456', 'arch046-fixture-nonce', true );
		self::assertCount( 1, $this->requests );
		self::assertSame( 'GRANT', json_decode( $this->requests[0][1]['body'], true )['decision'] );
	}
}
