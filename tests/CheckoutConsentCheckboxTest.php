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
		$GLOBALS['arch046_order_received'] = false;
		$GLOBALS['arch046_order_pay'] = false;
		$GLOBALS['moda_interact_test_hooks'] = array();
		$GLOBALS['moda_interact_options'] = array( 'blogname' => 'Test Merchant' );
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_store_locale'] = 'en_GB';
		$_SERVER['REQUEST_URI'] = '/';
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

	public function test_classic_checkbox_is_optional_unchecked_near_billing_phone(): void {
		$enabled = true;
		$checkbox = new CheckoutConsentCheckbox( static function () use ( &$enabled ): bool { return $enabled; } );
		$original = array( 'billing' => array( 'billing_phone' => array( 'priority' => 95 ) ) );
		$result = $checkbox->classicFields( $original );
		$field = $result['billing'][ CheckoutConsentCheckbox::CLASSIC_FIELD ];
		self::assertFalse( $field['required'] );
		self::assertSame( 0, $field['default'] );
		self::assertSame( 96, $field['priority'] );
		$withdrawal = $result['billing'][ CheckoutConsentCheckbox::CLASSIC_WITHDRAW_FIELD ];
		self::assertSame( 'select', $withdrawal['type'] );
		self::assertFalse( $withdrawal['required'] );
		self::assertSame( 'unchanged', $withdrawal['default'] );
		self::assertSame( 97, $withdrawal['priority'] );
		self::assertArrayHasKey( CheckoutConsentCheckbox::WITHDRAW_VALUE, $withdrawal['options'] );
		self::assertStringContainsString( 'WhatsApp marketing reminders', $field['label'] );
		self::assertStringContainsString( 'Test Merchant', $field['label'] );
		self::assertSame( 'en-GB', $field['custom_attributes']['data-moda-consent-locale'] );
		self::assertSame( CheckoutConsentCheckbox::DISCLOSURE_VERSION, $field['custom_attributes']['data-moda-consent-version'] );
		self::assertSame( $result, $checkbox->classicFields( $result ), 'One checkbox after a repeated filter pass' );
		$enabled = false;
		self::assertSame( $original, $checkbox->classicFields( $original ) );
	}

	public function test_blocks_register_once_only_for_eligible_checkout_and_never_prefill_profile(): void {
		$enabled = false;
		$checkbox = new CheckoutConsentCheckbox( static function () use ( &$enabled ): bool { return $enabled; } );
		$checkbox->register();
		self::assertCount( 1, $GLOBALS['arch046_checkbox_filters']['woocommerce_checkout_fields'] );
		$GLOBALS['arch046_checkout_page'] = true;
		$checkbox->registerBlocksForCheckoutPage();
		self::assertCount( 0, $GLOBALS['arch046_checkbox_blocks'] );
		$enabled = true;
		$checkbox->registerBlocksForCheckoutPage();
		$checkbox->registerBlocksForCheckoutPage();
		$_SERVER['REQUEST_URI'] = '/wp-json/wc/store/v1/checkout';
		$checkbox->registerBlocksForStoreApi();
		self::assertCount( 2, $GLOBALS['arch046_checkbox_blocks'] );
		$field = $GLOBALS['arch046_checkbox_blocks'][0];
		$withdrawal = $GLOBALS['arch046_checkbox_blocks'][1];
		self::assertSame( CheckoutConsentCheckbox::BLOCK_WITHDRAW_FIELD, $withdrawal['id'] );
		self::assertSame( 'select', $withdrawal['type'] );
		self::assertSame( 'order', $withdrawal['location'] );
		self::assertFalse( $withdrawal['required'] );
		self::assertCount( 1, $withdrawal['options'] );
		self::assertSame( CheckoutConsentCheckbox::BLOCK_FIELD, $field['id'] );
		self::assertSame( 'order', $field['location'] );
		self::assertSame( 'checkbox', $field['type'] );
		self::assertFalse( $field['required'] );
		self::assertSame( $field['label'], $field['optionalLabel'] );
	}

	public function test_inactive_or_order_received_pages_do_not_register_blocks(): void {
		$checkbox = new CheckoutConsentCheckbox( static fn(): bool => true );
		$checkbox->registerBlocksForCheckoutPage();
		$checkbox->registerBlocksForStoreApi();
		self::assertSame( array(), $GLOBALS['arch046_checkbox_blocks'] );
		$GLOBALS['arch046_checkout_page'] = true;
		$GLOBALS['arch046_order_received'] = true;
		$checkbox->registerBlocksForCheckoutPage();
		self::assertSame( array(), $GLOBALS['arch046_checkbox_blocks'] );
		$_SERVER['REQUEST_URI'] = '/?rest_route=%2Fwc%2Fstore%2Fv1%2Fcheckout';
		$checkbox->registerBlocksForStoreApi();
		self::assertCount( 2, $GLOBALS['arch046_checkbox_blocks'] );

		$GLOBALS['arch046_checkbox_blocks'] = array();
		$pay_page = new CheckoutConsentCheckbox( static fn(): bool => true );
		$GLOBALS['arch046_order_received'] = false;
		$GLOBALS['arch046_order_pay'] = true;
		$pay_page->registerBlocksForCheckoutPage();
		self::assertCount( 0, $GLOBALS['arch046_checkbox_blocks'] );
	}

	public function test_disclosure_is_a_versioned_locale_specific_purpose_not_a_grant(): void {
		$GLOBALS['moda_interact_store_locale'] = 'fr_FR';
		$disclosure = CheckoutConsentCheckbox::disclosure();
		self::assertSame( 'fr-FR', $disclosure['locale'] );
		self::assertSame( 'moda.woo.whatsapp-recovery-marketing.v1', $disclosure['version'] );
		self::assertStringContainsString( 'unfinished checkout', $disclosure['text'] );
	}
}
