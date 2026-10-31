<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentEligibility;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCheckbox;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Security\Base64Url;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutConsentEligibility.php';
require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutConsentCheckbox.php';

if ( ! function_exists( 'switch_to_locale' ) ) {
	function switch_to_locale( $locale ) {
		$GLOBALS['arch046_checkbox_locale_stack'][] = get_locale();
		$GLOBALS['arch046_checkbox_switched_locales'][] = $locale;
		$GLOBALS['moda_interact_store_locale'] = $locale;
		return true;
	}
}
if ( ! function_exists( 'restore_previous_locale' ) ) {
	function restore_previous_locale() {
		$GLOBALS['moda_interact_store_locale'] = array_pop( $GLOBALS['arch046_checkbox_locale_stack'] );
		return true;
	}
}

if ( ! function_exists( 'add_filter' ) ) {
	function add_filter( $name, $callback, $priority = 10, $accepted_args = 1 ) {
		$GLOBALS['arch046_checkbox_filters'][ $name ][] = $callback;
	}
}
if ( ! function_exists( 'woocommerce_register_additional_checkout_field' ) ) {
	function woocommerce_register_additional_checkout_field( $definition ) {
		$GLOBALS['arch046_checkbox_blocks'][] = $definition;
	}
}
if ( ! function_exists( 'get_permalink' ) ) {
	function get_permalink( $page_id ) {
		return $GLOBALS['arch046_checkout_permalink'] ?? 'https://merchant.example/checkout/';
	}
}
if ( ! function_exists( 'has_block' ) ) {
	function has_block( $name ) { return $GLOBALS['arch046_is_blocks_checkout'] ?? false; }
}
if ( ! function_exists( 'is_checkout' ) ) {
	function is_checkout() { return $GLOBALS['arch046_checkout_page'] ?? false; }
}
if ( ! function_exists( 'is_order_received_page' ) ) {
	function is_order_received_page() { return $GLOBALS['arch046_order_received'] ?? false; }
}
if ( ! function_exists( 'is_checkout_pay_page' ) ) {
	function is_checkout_pay_page() { return $GLOBALS['arch046_order_pay'] ?? false; }
}

final class CheckoutConsentCheckboxTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['arch046_checkbox_filters'] = array();
		$GLOBALS['arch046_checkbox_blocks'] = array();
		$GLOBALS['arch046_checkout_page'] = false;
		$GLOBALS['arch046_is_blocks_checkout'] = false;
		$GLOBALS['arch046_order_received'] = false;
		$GLOBALS['arch046_order_pay'] = false;
		$GLOBALS['arch046_checkout_permalink'] = 'https://merchant.example/checkout/';
		$GLOBALS['moda_interact_test_hooks'] = array();
		$GLOBALS['moda_interact_is_admin'] = false;
		$GLOBALS['moda_interact_options'] = array( 'blogname' => 'Test Merchant',
			'WPLANG' => 'en_GB', 'woocommerce_checkout_page_id' => 123 );
		$GLOBALS['arch046_checkbox_locale_stack'] = array();
		$GLOBALS['arch046_checkbox_switched_locales'] = array();
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_store_locale'] = 'en_GB';
		$_SERVER['REQUEST_URI'] = '/';
	}

	protected function tearDown(): void {
		$GLOBALS['moda_interact_is_admin'] = true;
		unset( $_SERVER['REQUEST_URI'] );
	}

	private function connection(): array {
		return array(
			'schemaVersion' => 1,
			'installationId' => 'installation-a',
			'shopId' => 'shop-a',
			'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( 'a', 32 ) ),
			'credentialVersion' => 1,
			'connectedAt' => '2026-10-23T10:00:00Z',
		);
	}

	private function reader( array $features, ?callable $transport = null ): CheckoutConsentEligibility {
		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = $this->connection();
		$transport = $transport ?? static fn() => array(
			'response' => array( 'code' => 200 ),
			'headers' => array( 'content-type' => 'application/json' ),
			'body' => json_encode( $features ),
		);
		return new CheckoutConsentEligibility(
			new ModaApiClient( ModaApiConfiguration::fromServerConfiguration(), $transport ),
			new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC,
				static fn( string $hostname ): array => array( '93.184.216.34' ) ),
			new InstallationStore()
		);
	}

	private function features( bool $effective = true, bool $planEligible = true ): array {
		return array(
			'schemaVersion' => 1,
			'revision' => str_repeat( 'a', 64 ),
			'features' => array( array(
				'id' => 'feature-1', 'key' => 'checkout_recovery',
				'name' => 'Checkout Recovery', 'description' => null,
				'enabled' => true, 'effective' => $effective,
				'editable' => false, 'required' => true, 'planEligible' => $planEligible,
			) ),
		);
	}

	public function test_remote_feature_and_installation_must_remain_current(): void {
		$reader = $this->reader( $this->features() );
		self::assertTrue( $reader->eligible() );
		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = null;
		self::assertFalse( $reader->eligible() );
		$reader = $this->reader( $this->features( false ) );
		self::assertFalse( $reader->eligible() );
		$reader = $this->reader( $this->features( true, false ) );
		self::assertFalse( $reader->eligible() );
		$reader = $this->reader( array( 'schemaVersion' => 1, 'revision' => 'bad', 'features' => array() ) );
		self::assertFalse( $reader->eligible() );
	}

	public function test_revocation_or_reconnect_during_feature_read_fails_closed(): void {
		$features = $this->features();
		$reader = $this->reader( $features, static function () use ( $features ): array {
			$changed = $GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ];
			$changed['credentialVersion']++;
			$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = $changed;
			return array( 'response' => array( 'code' => 200 ), 'headers' => array( 'content-type' => 'application/json' ), 'body' => json_encode( $features ) );
		} );
		self::assertFalse( $reader->eligible() );
		$reader = $this->reader( $features, static fn() => array( 'response' => array( 'code' => 401 ), 'body' => '{}' ) );
		self::assertFalse( $reader->eligible() );
		$GLOBALS['moda_interact_home_url'] = 'https://changed.example';
		self::assertFalse( $this->reader( $features )->eligible() );
	}

	public function test_original_wp_transport_error_is_retained_for_redacted_logging(): void {
		$client = new ModaApiClient( ModaApiConfiguration::fromServerConfiguration(),
			static fn(): WP_Error => new WP_Error( 'http_request_failed',
				'cURL error 28: Operation timed out after 2000 milliseconds' ) );
		$this->reader( $this->features() );
		$record = ( new InstallationStore() )->read()['record'];
		try {
			$client->merchantKnowledgeExchange( $record, '/v1/merchant/feature-preferences', 'GET', null, 2 );
			self::fail( 'Expected a transport exception' );
		} catch ( \ModaInteract\WooCommerce\Api\ModaApiClientException $error ) {
			self::assertSame( 'remote_unavailable', $error->getMessage() );
			self::assertSame( 'http_request_failed', $error->transport_error_code );
			self::assertSame( 'cURL error 28: Operation timed out after 2000 milliseconds',
				$error->transport_error_message );
		}
	}

	public function test_transport_diagnostics_keep_cause_and_redact_sensitive_details(): void {
		$clean = ( new ReflectionMethod(
			\ModaInteract\WooCommerce\Checkout\CheckoutConsentDiagnostics::class,
			'safeTransportMessage'
		) )->invoke( null,
			'cURL error 28: Operation timed out. URL https://example.test/secret?token=abcd ' .
			'email a@example.test Bearer abc123 Authorization: supersecret phone 447400123456' );
		self::assertStringContainsString( 'cURL error 28: Operation timed out.', $clean );
		foreach ( array( 'https://example.test', 'a@example.test', 'abc123', 'supersecret',
			'447400123456' ) as $secret ) {
			self::assertStringNotContainsString( $secret, $clean );
		}
	}

	public function test_checkout_feature_read_uses_a_short_request_deadline(): void {
		$timeouts = array();
		$features = $this->features();
		$reader = $this->reader( $features, static function ( string $url, array $args ) use ( &$timeouts, $features ): array {
			$timeouts[] = $args['timeout'] ?? null;
			return array( 'response' => array( 'code' => 200 ),
				'headers' => array( 'content-type' => 'application/json' ),
				'body' => json_encode( $features ) );
		} );
		self::assertTrue( $reader->eligible() );
		self::assertSame( array( 2 ), $timeouts );
	}

	public function test_presentation_uses_no_remote_feature_read_but_commands_recheck_fresh_state(): void {
		$reads = 0;
		$features = $this->features();
		$reader = $this->reader( $features, static function () use ( &$reads, $features ): array {
			++$reads;
			return array( 'response' => array( 'code' => 200 ),
				'headers' => array( 'content-type' => 'application/json' ),
				'body' => json_encode( $features ) );
		} );
		self::assertTrue( $reader->eligibleForPresentation() );
		self::assertTrue( $reader->eligibleForPresentation() );
		self::assertSame( 0, $reads, 'A checkout page never calls the remote feature API' );
		self::assertTrue( $reader->eligible(), 'Explicit GRANT still checks the hosted feature' );
		self::assertSame( 1, $reads );
		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = null;
		self::assertTrue( $reader->eligibleForPresentation(), 'Presentation memo is request-local only' );
		self::assertFalse( $reader->eligible(), 'Consent action detects a disconnected installation' );
	}

	public function test_hosted_timeout_cannot_hide_checkbox_or_authorise_grant(): void {
		$reads = 0;
		$reader = $this->reader( $this->features(), static function () use ( &$reads ): WP_Error {
			++$reads;
			return new WP_Error( 'http_request_failed',
				'cURL error 28: Operation timed out after 2000 milliseconds' );
		} );
		self::assertTrue( $reader->eligibleForPresentation() );
		$fields = ( new CheckoutConsentCheckbox( static fn(): bool => $reader->eligibleForPresentation() ) )
			->classicFields( array( 'billing' => array( 'billing_phone' => array( 'priority' => 50 ) ) ) );
		self::assertArrayHasKey( CheckoutConsentCheckbox::CLASSIC_FIELD, $fields['billing'] );
		$_SERVER['REQUEST_URI'] = '/checkout/';
		( new CheckoutConsentCheckbox( static fn(): bool => $reader->eligibleForPresentation() ) )->registerBlocksAtInit();
		self::assertCount( 1, $GLOBALS['arch046_checkbox_blocks'] );
		self::assertSame( 0, $reads, 'Neither Classic nor Blocks makes an HTTP request to render' );
		self::assertFalse( $reader->eligible(), 'A transport timeout still fails closed for GRANT' );
		self::assertSame( 1, $reads );
	}

	public function test_ineligible_hosted_feature_cannot_authorise_grant_even_if_checkbox_renders(): void {
		$reader = $this->reader( $this->features( false ) );
		self::assertTrue( $reader->eligibleForPresentation(), 'A local installation permits display' );
		self::assertFalse( $reader->eligible(), 'Hosted disabled feature forbids GRANT' );
		$reader = $this->reader( $this->features( true, false ) );
		self::assertTrue( $reader->eligibleForPresentation() );
		self::assertFalse( $reader->eligible(), 'Hosted ineligible plan forbids GRANT' );
	}

	public function test_local_installation_or_site_mismatch_prevents_display_without_feature_read(): void {
		$reads = 0;
		$reader = $this->reader( $this->features(), static function () use ( &$reads ): array {
			++$reads;
			return array();
		} );
		$GLOBALS['moda_interact_home_url'] = 'https://changed.example';
		self::assertFalse( $reader->eligibleForPresentation() );
		self::assertSame( 0, $reads );
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_options'][ InstallationStore::OPTION_NAME ] = null;
		$missing = new CheckoutConsentEligibility();
		self::assertFalse( $missing->eligibleForPresentation() );
	}

	public function test_classic_checkbox_is_optional_unchecked_near_billing_phone(): void {
		$enabled = true;
		$checkbox = new CheckoutConsentCheckbox( static function () use ( &$enabled ): bool { return $enabled; } );
		$original = array( 'billing' => array( 'billing_phone' => array( 'priority' => 95 ) ) );
		$result = $checkbox->classicFields( $original );
		$field = $result['billing'][ CheckoutConsentCheckbox::CLASSIC_FIELD ];
		self::assertFalse( $field['required'] );
		self::assertSame( 0, $field['default'] );
		self::assertSame( 96, $field['priority'] );
		self::assertCount( 2, $result['billing'], 'No withdrawal select is registered' );
		self::assertSame( 'Send me WhatsApp shopping updates, reminders and offers.', $field['label'] );
		self::assertStringNotContainsString( 'Test Merchant', $field['label'] );
		self::assertStringNotContainsString( 'https://merchant.example', $field['label'] );
		self::assertSame( 'en-GB', $field['custom_attributes']['data-moda-consent-locale'] );
		self::assertSame( CheckoutConsentCheckbox::DISCLOSURE_VERSION, $field['custom_attributes']['data-moda-consent-version'] );
		self::assertSame( $result, $checkbox->classicFields( $result ), 'One checkbox after a repeated filter pass' );
		$enabled = false;
		self::assertSame( $original, $checkbox->classicFields( $original ) );
	}

	public function test_classic_eligibility_exception_does_not_break_checkout(): void {
		$checkbox = new CheckoutConsentCheckbox( static function (): bool {
			throw new \RuntimeException( 'test feature-read failure' );
		} );
		$fields = array( 'billing' => array( 'billing_phone' => array( 'priority' => 95 ) ) );
		self::assertSame( $fields, $checkbox->classicFields( $fields ) );
	}

	public function test_classic_uses_only_native_checkbox_without_a_withdrawal_button(): void {
		$checkbox = new CheckoutConsentCheckbox( static fn(): bool => true );
		$checkbox->register();
		self::assertCount( 1, $GLOBALS['arch046_checkbox_filters']['woocommerce_checkout_fields'] );
		self::assertArrayNotHasKey( 'woocommerce_after_checkout_billing_form',
			$GLOBALS['moda_interact_test_hooks'], 'No separate withdrawal control is registered' );
		$fields = $checkbox->classicFields( array(
			'billing' => array( 'billing_phone' => array( 'priority' => 95 ) ),
		) );
		self::assertCount( 2, $fields['billing'] );
		self::assertSame( 0, $fields['billing'][ CheckoutConsentCheckbox::CLASSIC_FIELD ]['default'] );
	}

	public function test_blocks_registers_native_field_at_woocommerce_init_on_checkout(): void {
		$reads = 0;
		$checkbox = new CheckoutConsentCheckbox( static function () use ( &$reads ): bool {
			++$reads;
			return true;
		} );
		$_SERVER['REQUEST_URI'] = '/checkout/';
		$checkbox->register();
		self::assertArrayHasKey( 'woocommerce_init', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayNotHasKey( 'wp', $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayNotHasKey( 'rest_api_init', $GLOBALS['moda_interact_test_hooks'] );
		$checkbox->registerBlocksAtInit();
		$checkbox->registerBlocksAtInit();
		self::assertSame( 1, $reads );
		self::assertCount( 1, $GLOBALS['arch046_checkbox_blocks'] );
		$field = $GLOBALS['arch046_checkbox_blocks'][0];
		self::assertSame( CheckoutConsentCheckbox::BLOCK_FIELD, $field['id'] );
		self::assertSame( 'contact', $field['location'] );
		self::assertSame( 'checkbox', $field['type'] );
		self::assertFalse( $field['required'] );
		self::assertSame( '1', $field['attributes']['data-moda-consent-control'] );
		self::assertSame( $field['label'], $field['optionalLabel'] );
		self::assertFalse( $field['sanitize_callback']( true ) );
		self::assertFalse( $field['sanitize_callback']( '1' ) );
		self::assertFalse( $GLOBALS['arch046_checkbox_filters'][
			'woocommerce_get_default_value_for_' . CheckoutConsentCheckbox::BLOCK_FIELD
		][0]() );
	}

	public function test_native_field_fails_closed_without_eligibility_and_never_breaks_checkout(): void {
		$_SERVER['REQUEST_URI'] = '/checkout/';
		$checkbox = new CheckoutConsentCheckbox( static fn(): bool => false );
		$checkbox->registerBlocksAtInit();
		self::assertSame( array(), $GLOBALS['arch046_checkbox_blocks'] );
		$checkbox = new CheckoutConsentCheckbox( static function (): bool {
			throw new \RuntimeException( 'test provider timeout' );
		} );
		$checkbox->registerBlocksAtInit();
		self::assertSame( array(), $GLOBALS['arch046_checkbox_blocks'] );
	}

	public function test_native_registration_skips_unrelated_pages_without_a_feature_request(): void {
		$reads = 0;
		$checkbox = new CheckoutConsentCheckbox( static function () use ( &$reads ): bool {
			++$reads;
			return true;
		} );
		$_SERVER['REQUEST_URI'] = '/product/hat/';
		$checkbox->registerBlocksAtInit();
		self::assertSame( 0, $reads );
		self::assertSame( array(), $GLOBALS['arch046_checkbox_blocks'] );
	}

	public function test_native_registration_skips_order_pay_and_received_requests(): void {
		$checkbox = new CheckoutConsentCheckbox( static fn(): bool => true );
		foreach ( array( '/checkout/order-pay/123/', '/checkout/order-received/123/',
			'/checkout/?order-pay=123', '/checkout/?order-received=123' ) as $url ) {
			$_SERVER['REQUEST_URI'] = $url;
			$checkbox->registerBlocksAtInit();
		}
		self::assertSame( array(), $GLOBALS['arch046_checkbox_blocks'] );
	}

	public function test_native_store_api_registration_is_early_and_never_calls_remote_features(): void {
		$reads = 0;
		$checkbox = new CheckoutConsentCheckbox( static function () use ( &$reads ): bool {
			++$reads;
			return false;
		} );
		$_SERVER['REQUEST_URI'] = '/wp-json/wc/store/v1/cart/extensions';
		$checkbox->registerBlocksAtInit();
		self::assertCount( 1, $GLOBALS['arch046_checkbox_blocks'] );
		self::assertSame( 0, $reads );
		$checkbox->registerBlocksAtInit();
		self::assertCount( 1, $GLOBALS['arch046_checkbox_blocks'] );
	}

	public function test_plain_permalink_checkout_and_store_api_query_route(): void {
		$checkbox = new CheckoutConsentCheckbox( static fn(): bool => true );
		$GLOBALS['arch046_checkout_permalink'] = 'https://merchant.example/?page_id=123';
		$_SERVER['REQUEST_URI'] = '/?page_id=123';
		$checkbox->registerBlocksAtInit();
		self::assertCount( 1, $GLOBALS['arch046_checkbox_blocks'] );
		// Even with pretty permalinks configured, WordPress accepts a direct
		// ?page_id checkout URL (the disposable Chromium test uses this).
		$GLOBALS['arch046_checkbox_blocks'] = array();
		$GLOBALS['arch046_checkout_permalink'] = 'https://merchant.example/checkout/';
		$by_id = new CheckoutConsentCheckbox( static fn(): bool => true );
		$by_id->registerBlocksAtInit();
		self::assertCount( 1, $GLOBALS['arch046_checkbox_blocks'] );
		// A fresh instance with only an API route, no queried WP page.
		$GLOBALS['arch046_checkbox_blocks'] = array();
		$second = new CheckoutConsentCheckbox( static fn(): bool => false );
		$_SERVER['REQUEST_URI'] = '/?rest_route=%2Fwc%2Fstore%2Fv1%2Fcheckout';
		$second->registerBlocksAtInit();
		self::assertCount( 1, $GLOBALS['arch046_checkbox_blocks'] );
	}

	public function test_disclosure_is_a_versioned_locale_specific_purpose_not_a_grant(): void {
		$GLOBALS['moda_interact_options']['WPLANG'] = 'fr_FR';
		$disclosure = CheckoutConsentCheckbox::disclosure();
		self::assertSame( 'fr-FR', $disclosure['locale'] );
		self::assertSame( 'moda.woo.whatsapp-recovery-marketing.v3', $disclosure['version'] );
		self::assertSame( 'Send me WhatsApp shopping updates, reminders and offers.', $disclosure['text'] );
		self::assertStringNotContainsString( 'Test Merchant', $disclosure['text'] );
		self::assertStringNotContainsString( 'https://merchant.example', $disclosure['text'] );
		self::assertSame( array( 'fr_FR' ), $GLOBALS['arch046_checkbox_switched_locales'] );
		self::assertSame( 'en_GB', get_locale(), 'Restore original locale after rendering' );
	}
	public function test_disclosure_uses_site_language_not_administrator_request_locale(): void {
		$GLOBALS['moda_interact_store_locale'] = 'fr_FR';
		$GLOBALS['moda_interact_options']['WPLANG'] = 'de_DE';
		$disclosure = CheckoutConsentCheckbox::disclosure();
		self::assertSame( 'de-DE', $disclosure['locale'] );
		self::assertSame( array( 'de_DE' ), $GLOBALS['arch046_checkbox_switched_locales'] );
		self::assertSame( 'fr_FR', get_locale() );
		self::assertSame( 'Send me WhatsApp shopping updates, reminders and offers.', $disclosure['text'] );
	}

	public function test_empty_site_language_uses_default_english(): void {
		$GLOBALS['moda_interact_options']['WPLANG'] = '';
		$disclosure = CheckoutConsentCheckbox::disclosure();
		self::assertSame( 'en-US', $disclosure['locale'] );
		self::assertSame( 'Send me WhatsApp shopping updates, reminders and offers.', $disclosure['text'] );
		self::assertSame( 'en_GB', get_locale() );
	}

}
