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

	public function test_native_woocommerce_fields_replace_custom_block_injection(): void {
		$reflection = new ReflectionClass( CheckoutConsentPresentation::class );
		self::assertFalse( $reflection->hasMethod( 'insertCheckoutConsentBlock' ) );
		self::assertFalse( $reflection->hasMethod( 'registerCheckoutBlock' ) );
		self::assertFalse( $reflection->hasMethod( 'enqueueBlockEditor' ) );
		self::assertTrue( $reflection->hasMethod( 'enqueue' ) );
	}

	public function test_presentation_eligibility_failure_does_not_break_checkout(): void {
		$presenter = new CheckoutConsentPresentation( static function (): bool {
			throw new \RuntimeException( 'test hosted feature timeout' );
		} );
		$check = new ReflectionMethod( CheckoutConsentPresentation::class, 'isCheckoutEnabled' );
		self::assertFalse( $check->invoke( $presenter ) );
		self::assertFalse( $check->invoke( $presenter ) );
	}

	public function test_request_scoped_local_decision_is_shared_without_blocking_checkout(): void {
		$reads = 0;
		$presenter = new CheckoutConsentPresentation( static function () use ( &$reads ): bool {
			++$reads;
			return true;
		} );
		$check = new ReflectionMethod( CheckoutConsentPresentation::class, 'isCheckoutEnabled' );
		self::assertTrue( $check->invoke( $presenter ) );
		self::assertTrue( $check->invoke( $presenter ) );
		self::assertSame( 1, $reads );
		$GLOBALS['arch046_order_received'] = true;
		self::assertFalse( $check->invoke( $presenter ) );
	}
}
