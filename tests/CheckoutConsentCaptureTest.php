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

require_once __DIR__ . '/fixtures/Arch046CartTokenUtils.php';

foreach ( array( 'CheckoutKey', 'CheckoutConsentPhone', 'CheckoutConsentCheckbox', 'CheckoutConsentEligibility', 'CheckoutConsentPublisher', 'CheckoutConsentCapture' ) as $name ) {
	require_once dirname( __DIR__ ) . '/includes/Checkout/' . $name . '.php';
}

if ( ! function_exists( 'WC' ) ) {
	function WC() { return $GLOBALS['arch035_wc']; }
}
if ( ! function_exists( 'as_schedule_single_action' ) ) {
	function as_schedule_single_action( $timestamp, $hook, $args, $group, $unique ) {
		$GLOBALS['arch035_delayed'][] = compact( 'timestamp', 'hook', 'args', 'group', 'unique' );
		$GLOBALS['arch046_scheduled'][] = compact( 'timestamp', 'hook', 'args', 'group', 'unique' );
		return count( $GLOBALS['arch035_delayed'] );
	}
}

final class Arch046Session {
	public array $items = array();
	public function get( string $key ): mixed { return $this->items[$key] ?? null; }
	public function set( string $key, mixed $value ): void { $this->items[$key] = $value; }
	public function get_customer_id(): string { return $this->items['customer_id'] ?? 'guest-session-1'; }
}
final class Arch046Cart {
	public function get_cart(): array { return array( array( 'product_id' => 1, 'quantity' => 1 ) ); }
}
final class Arch046Customer {
	public string $phone = '+447400123456';
	public string $country = 'GB';
	public function get_billing_phone(): string { return $this->phone; }
	public function get_billing_country(): string { return $this->country; }
}
final class Arch046Countries {
	public function get_allowed_countries(): array { return array( 'GB' => 'United Kingdom', 'US' => 'United States', 'FR' => 'France' ); }
}
final class Arch046CheckoutRequest {
	public function __construct( private array $fields, private string $nonce = 'arch046-fixture-nonce', private string $method = 'PUT', private ?string $cartToken = null ) {}
	public function get_method(): string { return $this->method; }
	public function get_header( $key ): ?string { return strtolower( $key ) === 'nonce' ? $this->nonce : ( strtolower( $key ) === 'cart-token' ? $this->cartToken : null ); }
	public function get_json_params(): array { return array( 'additional_fields' => $this->fields ); }
}

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

	public function test_explicit_classic_transition_mints_once_and_unchecked_default_does_not_grant(): void {
		$this->capture->register();
		$this->classic( false );
		self::assertCount( 0, $this->requests );
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$first = json_decode( $this->requests[0][1]['body'], true );
		self::assertSame( 'GRANT', $first['decision'] );
		self::assertSame( '447400123456', $first['canonicalPhone'] );
		self::assertSame( 'CLASSIC', $first['checkoutAction']['checkoutMode'] );
		self::assertSame( 'moda/whatsapp-checkout-recovery', $first['checkoutAction']['fieldId'] );
		self::assertSame( 'moda.woo.whatsapp-recovery-marketing.v1', $first['disclosure']['version'] );
		self::assertStringContainsString( 'https://merchant.example', $first['disclosure']['text'] );
		self::assertSame( 'en-GB', $first['disclosure']['locale'] );
		self::assertSame( 'Bearer ' . ( new InstallationStore() )->read()['record']['credential'], $this->requests[0][1]['headers']['Authorization'] );
		$this->classic( true );
		self::assertCount( 1, $this->requests );
		$this->classic( false );
		self::assertCount( 2, $this->requests );
		$second = json_decode( $this->requests[1][1]['body'], true );
		self::assertSame( 'REVOKE', $second['decision'] );
		self::assertNull( $second['disclosure'] );
		self::assertNotSame( $first['eventId'], $second['eventId'] );
		self::assertGreaterThan( $first['checkoutAction']['occurredAt'], $second['checkoutAction']['occurredAt'] );
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

	public function test_blocks_nonce_validation_session_login_change_and_server_observed_phone(): void {
		$GLOBALS['arch046_nonce_action'] = 'wc_store_api';
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => true ), 'forged' ) );
		self::assertCount( 0, $this->requests );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => false ) ) );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => true ) ) );
		self::assertCount( 1, $this->requests );
		$payload = json_decode( $this->requests[0][1]['body'], true );
		self::assertSame( 'BLOCKS', $payload['checkoutAction']['checkoutMode'] );
		self::assertSame( '+447400123456', $payload['checkoutAction']['serverObservedPhone'] );
		$GLOBALS['arch046_current_user_id'] = 4;
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => true ) ) );
		self::assertCount( 1, $this->requests, 'Login change cannot inherit an old check' );
	}



	public function test_existing_blocks_draft_order_put_captures_without_place_order(): void {
		$GLOBALS['arch046_nonce_action'] = 'wc_store_api';
		$this->capture->register();
		$hooks = $GLOBALS['moda_interact_test_hooks'];
		self::assertArrayHasKey( 'woocommerce_store_api_checkout_update_order_from_request', $hooks );
		$request = new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => true ), 'arch046-fixture-nonce', 'PUT' );
		$this->capture->blocksOrderDraft( (object) array( 'id' => 'existing-draft' ), $request );
		self::assertCount( 1, $this->requests );
		$this->capture->blocksOrderDraft( (object) array( 'id' => 'existing-draft' ), $request );
		self::assertCount( 1, $this->requests, 'Repeated draft PUT must not grant twice' );
		$this->capture->blocksOrderDraft( (object) array( 'id' => 'order-placed' ),
			new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => false ), 'arch046-fixture-nonce', 'POST' ) );
		self::assertCount( 1, $this->requests, 'Order POST meta cannot revoke or grant permission' );
	}

	public function test_blocks_checked_before_billing_phone_waits_for_authenticated_contact(): void {
		$GLOBALS['arch046_nonce_action'] = 'wc_store_api';
		$customer = $GLOBALS['arch046_woo']->customer;
		$customer->phone = '';
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => true ) ) );
		self::assertCount( 0, $this->requests, 'No GRANT without an observed billing phone' );
		$staged = $GLOBALS['arch046_woo']->session->get( 'moda_interact_checkout_blocks_waiting_for_phone_v1' );
		self::assertSame( true, is_array( $staged ) );
		$customer->phone = '+447400123456';
		$this->capture->blocksBillingUpdated( $customer, new Arch046CheckoutRequest( array(), 'arch046-fixture-nonce', 'POST' ) );
		self::assertCount( 1, $this->requests );
		$event = json_decode( $this->requests[0][1]['body'], true );
		self::assertSame( 'GRANT', $event['decision'] );
		self::assertSame( 'BLOCKS', $event['checkoutAction']['checkoutMode'] );
		self::assertNull( $GLOBALS['arch046_woo']->session->get( 'moda_interact_checkout_blocks_waiting_for_phone_v1' ) );
		$this->capture->blocksBillingUpdated( $customer, new Arch046CheckoutRequest( array(), 'arch046-fixture-nonce', 'POST' ) );
		self::assertCount( 1, $this->requests, 'No repeated GRANT from later contact changes' );
	}

	public function test_staged_blocks_consent_is_not_reused_after_login_or_deselection(): void {
		$GLOBALS['arch046_nonce_action'] = 'wc_store_api';
		$customer = $GLOBALS['arch046_woo']->customer;
		$customer->phone = '';
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => true ) ) );
		$GLOBALS['arch046_current_user_id'] = 22;
		$customer->phone = '+447400123456';
		$this->capture->blocksBillingUpdated( $customer, new Arch046CheckoutRequest( array(), 'arch046-fixture-nonce', 'POST' ) );
		self::assertCount( 0, $this->requests, 'Login change cannot reuse earlier choice' );
		$GLOBALS['arch046_current_user_id'] = 0;
		$customer->phone = '';
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => false ) ) );
		$customer->phone = '+447400123456';
		$this->capture->blocksBillingUpdated( $customer, new Arch046CheckoutRequest( array(), 'arch046-fixture-nonce', 'POST' ) );
		self::assertCount( 0, $this->requests, 'Unchecked choice cancels any previous stage' );
	}

	public function test_blocks_cart_token_binds_to_the_current_guest_session(): void {
		$GLOBALS['arch046_nonce_action'] = 'wc_store_api';
		$token = \Automattic\WooCommerce\StoreApi\Utilities\CartTokenUtils::get_cart_token( 'guest-session-1' );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => true ), '', 'PUT', 'forged-token' ) );
		self::assertCount( 0, $this->requests );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => true ), '', 'PUT', $token ) );
		self::assertCount( 1, $this->requests );
		$GLOBALS['arch046_woo']->session->set( 'customer_id', 'different-session' );
		$this->capture->blocksDraft( new Arch046CheckoutRequest( array( CheckoutConsentCheckbox::BLOCK_FIELD => false ), '', 'PUT', $token ) );
		self::assertCount( 1, $this->requests, 'A valid token for the previous guest is not transferable' );
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
		self::assertNotEmpty( $GLOBALS['arch046_woo']->session->get( 'moda_interact_checkout_consent_observation_v1' )['pending'] );
		$event = json_decode( $this->requests[0][1]['body'], true );
		$this->unavailable = false;
		$this->classic( true );
		self::assertCount( 2, $this->requests );
		self::assertSame( $event, json_decode( $this->requests[1][1]['body'], true ) );
		self::assertCount( 0, $GLOBALS['moda_interact_external_requests'], 'No checkout/Meta/billing side effect' );
	}
}
