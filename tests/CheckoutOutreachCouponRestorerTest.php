<?php

use ModaInteract\WooCommerce\Checkout\CheckoutOutreachCouponRestorer;
use PHPUnit\Framework\TestCase;

if ( ! function_exists( 'wc_format_coupon_code' ) ) {
	function wc_format_coupon_code( string $code ): string { return strtolower( trim( $code ) ); }
}
if ( ! class_exists( '\WC_Cart' ) ) { class WC_Cart {} }
if ( ! function_exists( 'add_filter' ) ) {
	function add_filter( string $hook, callable $callback, int $priority = 10, int $accepted_args = 1 ): bool {
		$GLOBALS['arch053_offer_filters'][ $hook ][] = $callback;
		return true;
	}
}
if ( ! function_exists( 'remove_filter' ) ) {
	function remove_filter( string $hook, callable $callback, int $priority = 10 ): bool {
		$GLOBALS['arch053_offer_filters'][ $hook ] = array_values( array_filter(
			$GLOBALS['arch053_offer_filters'][ $hook ] ?? array(), static fn( $registered ): bool => $registered !== $callback
		) );
		return true;
	}
}

final class OutreachOfferTestCart extends WC_Cart {
	public array $coupons = array();
	public array $attempts = array();
	public array $reject = array();
	public array $replaceExisting = array();
	public bool $failRemoval = false;
	public bool $sparseCoupons = false;
	public int $calculations = 0;
	public function get_applied_coupons(): array {
		if ( ! $this->sparseCoupons ) return $this->coupons;
		$sparse = array();
		foreach ( $this->coupons as $index => $code ) $sparse[ $index + 1 ] = $code;
		return $sparse;
	}
	public function apply_coupon( string $code ): bool {
		$this->attempts[] = $code;
		if ( in_array( strtolower( $code ), $this->reject, true ) ) return false;
		foreach ( $this->replaceExisting as $replacement => $removed ) {
			if ( strtolower( $replacement ) === strtolower( $code ) ) {
				$this->coupons = array_values( array_filter( $this->coupons, static fn( $current ): bool => ! in_array( strtolower( $current ), $removed, true ) ) );
			}
		}
		if ( ! in_array( strtolower( $code ), array_map( 'strtolower', $this->coupons ), true ) ) $this->coupons[] = strtolower( $code );
		return true;
	}
	public function remove_coupon( string $code ): void {
		if ( $this->failRemoval ) throw new RuntimeException( 'remove failed' );
		$this->coupons = array_values( array_filter( $this->coupons, static fn( $current ): bool => strtolower( $current ) !== strtolower( $code ) ) );
	}
	public function calculate_totals(): void { ++$this->calculations; }
}

final class CheckoutOutreachCouponRestorerTest extends TestCase {
	private CheckoutOutreachCouponRestorer $restorer;
	private OutreachOfferTestCart $cart;

	protected function setUp(): void {
		$GLOBALS['arch053_offer_filters'] = array();
		$this->restorer = new CheckoutOutreachCouponRestorer();
		$this->cart = new OutreachOfferTestCart();
	}

	public function test_handles_none_unverifiable_automatic_and_alternative_without_forcing_discounts(): void {
		$cases = array(
			array( array( 'kind' => 'NONE', 'reason' => 'NO_CONFIRMED_OFFER' ), 'NO_OFFER' ),
			array( array( 'kind' => 'NONE', 'reason' => 'UNVERIFIABLE' ), 'UNVERIFIABLE' ),
			array( array( 'kind' => 'CHECKOUT_AUTOMATIC', 'providerDiscountId' => 'discount-1' ), 'AUTOMATIC_NOT_FORCED' ),
			array( array( 'kind' => 'ALTERNATIVE_PRODUCT' ), 'NOT_APPLICABLE' ),
		);
		foreach ( $cases as [ $offer, $outcome ] ) {
			$result = $this->restorer->apply_outreach_offer( $offer, array(), $this->cart );
			self::assertSame( $outcome, $result['outcome'] );
		}
		self::assertSame( array(), $this->cart->attempts );
		self::assertSame( 4, $this->cart->calculations );
	}

	public function test_applies_currently_valid_code_once_and_does_not_duplicate_original_code(): void {
		$this->cart->coupons = array( 'save10' );
		$result = $this->restorer->apply_outreach_offer( array( 'kind' => 'CHECKOUT_CODE', 'code' => 'EXTRA15' ), array( 'SAVE10' ), $this->cart );
		self::assertSame( 'APPLIED', $result['outcome'] );
		self::assertSame( array( 'EXTRA15' ), $this->cart->attempts );
		$this->cart->coupons = array( 'save10', 'extra15' );
		$this->cart->attempts = array();
		$result = $this->restorer->apply_outreach_offer( array( 'kind' => 'CHECKOUT_CODE', 'code' => 'EXTRA15' ), array( 'SAVE10', 'EXTRA15' ), $this->cart );
		self::assertSame( 'ALREADY_APPLIED', $result['outcome'] );
		self::assertSame( array(), $this->cart->attempts );
	}

	public function test_rejected_code_preserves_originals_and_group_conflict_rolls_back_all_offer_codes(): void {
		$this->cart->coupons = array( 'save10' );
		$this->cart->reject = array( 'extra15' );
		$result = $this->restorer->apply_outreach_offer( array( 'kind' => 'CHECKOUT_CODE', 'code' => 'EXTRA15' ), array( 'SAVE10' ), $this->cart );
		self::assertSame( 'REJECTED', $result['outcome'] );
		self::assertSame( array( 'save10' ), $this->cart->coupons );
		$this->cart = new OutreachOfferTestCart();
		$this->cart->coupons = array( 'save10' );
		$this->cart->replaceExisting = array( 'extra15' => array( 'save10' ) );
		$result = $this->restorer->apply_outreach_offer( array( 'kind' => 'CHECKOUT_CODE', 'code' => 'EXTRA15' ), array( 'SAVE10' ), $this->cart );
		self::assertSame( 'CONFLICT_REQUIRES_CHOICE', $result['outcome'] );
		self::assertSame( array( 'save10' ), $this->cart->coupons );

		$this->cart = new OutreachOfferTestCart();
		$this->cart->coupons = array( 'save10' );
		$this->cart->replaceExisting = array( 'extra15' => array( 'save10' ) );
		$result = $this->restorer->apply_outreach_offer( array( 'kind' => 'CHECKOUT_OFFERS', 'offers' => array(
			array( 'method' => 'CODE', 'code' => 'EXTRA15' ),
			array( 'method' => 'CODE', 'code' => 'EXTRA20' ),
		) ), array( 'SAVE10' ), $this->cart );
		self::assertSame( 'CONFLICT_REQUIRES_CHOICE', $result['outcome'] );
		self::assertSame( 'GROUP_CONFLICT', $result['rejectionReason'] );
		self::assertSame( array( 'save10' ), $this->cart->coupons );
		self::assertNotContains( 'extra20', $this->cart->coupons );
	}

	public function test_valid_group_applies_codes_in_source_order_and_duplicate_codes_are_not_attempted_twice(): void {
		$result = $this->restorer->apply_outreach_offer( array( 'kind' => 'CHECKOUT_OFFERS', 'offers' => array(
			array( 'method' => 'CODE', 'code' => 'OFFER10' ),
			array( 'method' => 'AUTOMATIC' ),
			array( 'method' => 'CODE', 'code' => 'OFFER10' ),
		) ), array(), $this->cart );
		self::assertSame( 'APPLIED', $result['outcome'] );
		self::assertSame( array( 'OFFER10' ), $this->cart->attempts );
		self::assertSame( array( 'offer10' ), $this->cart->coupons );
	}

	public function test_group_rejection_never_keeps_a_partial_group_and_failed_rollback_throws(): void {
		$this->cart->reject = array( 'offer20' );
		$result = $this->restorer->apply_outreach_offer( array( 'kind' => 'CHECKOUT_OFFERS', 'offers' => array(
			array( 'method' => 'CODE', 'code' => 'OFFER10' ), array( 'method' => 'CODE', 'code' => 'OFFER20' ),
		) ), array(), $this->cart );
		self::assertSame( 'REJECTED', $result['outcome'] );
		self::assertSame( 'GROUP_REJECTED', $result['rejectionReason'] );
		self::assertSame( array(), $this->cart->coupons );
		$this->cart = new OutreachOfferTestCart();
		$this->cart->coupons = array( 'save10' );
		$this->cart->replaceExisting = array( 'extra15' => array( 'save10' ) );
		$this->cart->failRemoval = true;
		$this->expectException( RuntimeException::class );
		$this->restorer->apply_outreach_offer( array( 'kind' => 'CHECKOUT_CODE', 'code' => 'EXTRA15' ), array( 'SAVE10' ), $this->cart );
	}

	public function test_sparse_live_coupon_indexes_preserve_originals_after_group_conflict(): void {
		$this->cart->coupons = array( 'save10' );
		$this->cart->sparseCoupons = true;
		$this->cart->replaceExisting = array( 'extra15' => array( 'save10' ) );
		$result = $this->restorer->apply_outreach_offer( array( 'kind' => 'CHECKOUT_OFFERS', 'offers' => array(
			array( 'method' => 'CODE', 'code' => 'EXTRA15' ),
			array( 'method' => 'CODE', 'code' => 'EXTRA20' ),
		) ), array( 'SAVE10' ), $this->cart );
		self::assertSame( 'CONFLICT_REQUIRES_CHOICE', $result['outcome'] );
		self::assertSame( array( 'save10' ), $result['currentAppliedCodes'] );
		self::assertSame( array( 1 => 'save10' ), $this->cart->get_applied_coupons() );
	}
}
