<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Applies captured coupon codes through WooCommerce's current validation rules. */
final class CheckoutCouponRestorer {
	/** @return array{appliedCodes: array<string>, rejectedCodes: array<string>, cartTotalRecalculated: bool} */
	public function restore( object $cart, array $coupon_codes, bool $recalculate_totals = true ): array {
		if ( ! method_exists( $cart, 'apply_coupon' ) || ! method_exists( $cart, 'get_applied_coupons' ) ||
			! method_exists( $cart, 'calculate_totals' ) ) {
			throw new \RuntimeException( 'restore_coupon_cart_unavailable' );
		}

		$applied = array();
		$rejected = array();
		foreach ( $coupon_codes as $code ) {
			if ( ! is_string( $code ) || '' === $code ) throw new \RuntimeException( 'restore_coupon_code_invalid' );
			$notices = function_exists( 'wc_get_notices' ) ? wc_get_notices() : null;
			$suppress_coupon_error = static fn( mixed $message ): string => '';
			$filter_installed = function_exists( 'add_filter' ) && function_exists( 'remove_filter' );
			if ( $filter_installed ) {
				add_filter( 'woocommerce_coupon_error', $suppress_coupon_error, PHP_INT_MAX, 3 );
			}
			try {
				$cart->apply_coupon( $code );
			} finally {
				if ( $filter_installed ) {
					remove_filter( 'woocommerce_coupon_error', $suppress_coupon_error, PHP_INT_MAX );
				}
				if ( is_array( $notices ) && function_exists( 'wc_set_notices' ) ) wc_set_notices( $notices );
			}

			$actual_codes = $cart->get_applied_coupons();
			if ( ! is_array( $actual_codes ) ) throw new \RuntimeException( 'restore_coupon_state_unavailable' );
			if ( self::containsCode( $actual_codes, $code ) ) $applied[] = $code;
			else $rejected[] = $code;
		}

		if ( $recalculate_totals ) $cart->calculate_totals();
		return array( 'appliedCodes' => $applied, 'rejectedCodes' => $rejected, 'cartTotalRecalculated' => $recalculate_totals );
	}

	private static function containsCode( array $actual_codes, string $expected ): bool {
		$expected = self::normalizeCode( $expected );
		foreach ( $actual_codes as $actual ) {
			if ( is_string( $actual ) && self::normalizeCode( $actual ) === $expected ) return true;
		}
		return false;
	}

	private static function normalizeCode( string $code ): string {
		return function_exists( 'wc_format_coupon_code' ) ? wc_format_coupon_code( $code ) : strtolower( trim( $code ) );
	}
}
