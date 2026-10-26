<?php

use ModaInteract\WooCommerce\Checkout\CheckoutConsentPresentation;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutConsentPresentation.php';

if ( ! function_exists( 'is_checkout' ) ) {
	function is_checkout() { return $GLOBALS['arch046_checkout_page'] ?? false; }
}
if ( ! function_exists( 'is_order_received_page' ) ) {
	function is_order_received_page() { return $GLOBALS['arch046_order_received'] ?? false; }
}
if ( ! function_exists( 'is_checkout_pay_page' ) ) {
	function is_checkout_pay_page() { return $GLOBALS['arch046_order_pay'] ?? false; }
}

final class CheckoutConsentPresentationTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_is_admin'] = false;
		$GLOBALS['arch046_checkout_page'] = true;
		$GLOBALS['arch046_order_received'] = false;
		$GLOBALS['arch046_order_pay'] = false;
	}

	protected function tearDown(): void {
		$GLOBALS['moda_interact_is_admin'] = true;
		$GLOBALS['arch046_checkout_page'] = false;
	}

	private function checkoutFields(): string {
		return '<div data-block-name="woocommerce/checkout-fields-block" class="wp-block-woocommerce-checkout-fields-block">' .
			'<div data-block-name="woocommerce/checkout-contact-information-block"></div>' .
			'<div data-block-name="woocommerce/checkout-actions-block"></div></div>';
	}

	public function test_existing_checkout_renders_consent_inside_fields_before_place_order(): void {
		$reads = 0;
		$presenter = new CheckoutConsentPresentation( static function () use ( &$reads ): bool {
			++$reads;
			return true;
		} );
		$rendered = $presenter->renderCheckoutFields( $this->checkoutFields() );
		self::assertSame( 1, substr_count( $rendered, 'data-block-name="moda-interact/checkout-consent"' ) );
		self::assertSame( 1, substr_count( $rendered, 'data-moda-woo-runtime-mount="1"' ),
			'Only the synthetic checkout-fields placeholder is directly mounted' );
		self::assertLessThan( strpos( $rendered, 'data-block-name="woocommerce/checkout-actions-block"' ),
			strpos( $rendered, 'data-block-name="moda-interact/checkout-consent"' ) );
		self::assertSame( $rendered, $presenter->renderCheckoutFields( $rendered ), 'Do not duplicate a pre-existing block' );
		self::assertSame( 1, $reads, 'Avoid repeat feature-pref API requests while rendering the same page' );
	}

	public function test_only_an_eligible_customer_checkout_receives_a_mount(): void {
		$fields = $this->checkoutFields();
		$disabled = new CheckoutConsentPresentation( static fn(): bool => false );
		self::assertSame( $fields, $disabled->renderCheckoutFields( $fields ) );
		$enabled = new CheckoutConsentPresentation( static fn(): bool => true );
		$GLOBALS['moda_interact_is_admin'] = true;
		self::assertSame( $fields, $enabled->renderCheckoutFields( $fields ) );
		$GLOBALS['moda_interact_is_admin'] = false;
		$GLOBALS['arch046_order_received'] = true;
		self::assertSame( $fields, $enabled->renderCheckoutFields( $fields ) );
		$GLOBALS['arch046_order_received'] = false;
		$GLOBALS['arch046_checkout_page'] = false;
		self::assertSame( $fields, $enabled->renderCheckoutFields( $fields ) );
	}

	public function test_does_not_insert_consent_inside_checkout_totals_or_unexpected_markup(): void {
		$presenter = new CheckoutConsentPresentation( static fn(): bool => true );
		$totals = '<div data-block-name="woocommerce/checkout-totals-block"></div>';
		self::assertSame( $totals, $presenter->renderCheckoutFields( $totals ) );
		$unexpected = '<p>Not the checkout fields root</p>';
		self::assertSame( $unexpected, $presenter->renderCheckoutFields( $unexpected ) );
		$fieldsNoActions = '<div class="wp-block-woocommerce-checkout-fields-block"><p>Fields</p></div>';
		self::assertSame( 1, substr_count( $presenter->renderCheckoutFields( $fieldsNoActions ),
			'data-block-name="moda-interact/checkout-consent"' ) );
	}
}
