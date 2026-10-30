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

	private function child( string $name ): array {
		return array( 'blockName' => $name, 'attrs' => array(),
			'innerBlocks' => array(), 'innerHTML' => '', 'innerContent' => array() );
	}

	private function fields(): array {
		return array(
			'blockName' => 'woocommerce/checkout-fields-block',
			'attrs' => array(),
			'innerBlocks' => array(
				$this->child( 'woocommerce/checkout-contact-information-block' ),
				$this->child( 'woocommerce/checkout-actions-block' ),
			),
			'innerHTML' => '<div class="wp-block-woocommerce-checkout-fields-block"></div>',
			'innerContent' => array( '<div class="wp-block-woocommerce-checkout-fields-block">',
				null, null, '</div>' ),
		);
	}

	public function test_existing_saved_checkout_gets_one_real_parsed_child_before_actions(): void {
		$reads = 0;
		$presenter = new CheckoutConsentPresentation( static function () use ( &$reads ): bool {
			++$reads;
			return true;
		} );
		$fields = $this->fields();
		$result = $presenter->insertCheckoutConsentBlock( $fields );
		self::assertSame( 'moda-interact/checkout-consent', $result['innerBlocks'][1]['blockName'] );
		self::assertSame( 'woocommerce/checkout-actions-block', $result['innerBlocks'][2]['blockName'] );
		self::assertSame( array( '<div class="wp-block-woocommerce-checkout-fields-block">',
			null, null, null, '</div>' ), $result['innerContent'] );
		self::assertSame( $fields, $this->fields(), 'No saved post or original input mutation' );
		self::assertSame( $result, $presenter->insertCheckoutConsentBlock( $result ),
			'One checkout control even if WordPress reprocesses the same parsed tree' );
		self::assertSame( 1, $reads, 'Eligibility is memoized per page request' );
		self::assertStringNotContainsString( 'data-moda-woo-runtime-mount', json_encode( $result ) );
	}

	public function test_only_an_eligible_customer_checkout_receives_the_child(): void {
		$fields = $this->fields();
		$disabled = new CheckoutConsentPresentation( static fn(): bool => false );
		self::assertSame( $fields, $disabled->insertCheckoutConsentBlock( $fields ) );
		$enabled = new CheckoutConsentPresentation( static fn(): bool => true );
		$GLOBALS['moda_interact_is_admin'] = true;
		self::assertSame( $fields, $enabled->insertCheckoutConsentBlock( $fields ) );
		$GLOBALS['moda_interact_is_admin'] = false;
		$GLOBALS['arch046_order_received'] = true;
		self::assertSame( $fields, $enabled->insertCheckoutConsentBlock( $fields ) );
		$GLOBALS['arch046_order_received'] = false;
		$GLOBALS['arch046_checkout_page'] = false;
		self::assertSame( $fields, $enabled->insertCheckoutConsentBlock( $fields ) );
	}

	public function test_never_inserts_in_totals_or_a_malformed_checkout_tree(): void {
		$presenter = new CheckoutConsentPresentation( static fn(): bool => true );
		$totals = $this->fields();
		$totals['blockName'] = 'woocommerce/checkout-totals-block';
		self::assertSame( $totals, $presenter->insertCheckoutConsentBlock( $totals ) );
		$fields = $this->fields();
		$fields['innerContent'] = array( '<div>', null, '</div>' );
		self::assertSame( $fields, $presenter->insertCheckoutConsentBlock( $fields ),
			'Malformed innerContent must not render a duplicate/outside child' );
	}

	public function test_insert_when_there_are_no_saved_children_keeps_block_inside_wrapper(): void {
		$presenter = new CheckoutConsentPresentation( static fn(): bool => true );
		$fields = $this->fields();
		$fields['innerBlocks'] = array();
		$fields['innerContent'] = array( '<div class="wp-block-woocommerce-checkout-fields-block"></div>' );
		$result = $presenter->insertCheckoutConsentBlock( $fields );
		self::assertCount( 1, $result['innerBlocks'] );
		self::assertSame( array( '<div class="wp-block-woocommerce-checkout-fields-block">',
			null, '</div>' ), $result['innerContent'] );
	}
}
