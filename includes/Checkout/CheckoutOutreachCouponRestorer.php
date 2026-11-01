<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Applies only confirmed outreach codes through Woo's current coupon rules. */
final class CheckoutOutreachCouponRestorer {
	/** @return array{outcome:'NO_OFFER'|'UNVERIFIABLE'|'NOT_APPLICABLE'|'AUTOMATIC_NOT_FORCED'|'APPLIED'|'ALREADY_APPLIED'|'REJECTED'|'CONFLICT_REQUIRES_CHOICE',recommendedCode:?string,originalAppliedCodes:list<string>,currentAppliedCodes:list<string>,rejectionReason:?string,totalsRecalculated:bool} */
	public function apply_outreach_offer( array $validatedOffer, array $appliedOriginalCoupons, \WC_Cart $cart ): array {
		if ( ! method_exists( $cart, 'get_applied_coupons' ) || ! method_exists( $cart, 'apply_coupon' ) ||
			! method_exists( $cart, 'remove_coupon' ) || ! method_exists( $cart, 'calculate_totals' ) ) {
			throw new \RuntimeException( 'restore_offer_cart_unavailable' );
		}
		$initial = self::couponList( $cart->get_applied_coupons() );
		$originals = self::couponList( $appliedOriginalCoupons );
		if ( null === $initial || null === $originals || ! self::containsAll( $initial, $originals ) ) {
			throw new \RuntimeException( 'restore_offer_original_state_unavailable' );
		}

		$kind = $validatedOffer['kind'] ?? null;
		$recommended = null;
		$outcome = 'NO_OFFER';
		$reason = null;
		$must_restore_originals = false;
		if ( 'NONE' === $kind ) {
			$outcome = 'UNVERIFIABLE' === ( $validatedOffer['reason'] ?? null ) ? 'UNVERIFIABLE' : 'NO_OFFER';
		} elseif ( 'ALTERNATIVE_PRODUCT' === $kind ) {
			$outcome = 'NOT_APPLICABLE';
		} elseif ( 'CHECKOUT_AUTOMATIC' === $kind ) {
			$outcome = 'AUTOMATIC_NOT_FORCED';
		} elseif ( 'CHECKOUT_CODE' === $kind ) {
			$recommended = $validatedOffer['code'] ?? null;
			if ( ! is_string( $recommended ) || '' === $recommended ) throw new \RuntimeException( 'restore_offer_contract_invalid' );
			if ( self::containsCode( $initial, $recommended ) ) {
				$outcome = 'ALREADY_APPLIED';
			} else {
				self::attempt( $cart, $recommended );
				$current = self::couponList( $cart->get_applied_coupons() );
				if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable' );
				if ( ! self::containsAll( $current, $originals ) ) {
					$outcome = 'CONFLICT_REQUIRES_CHOICE';
					$reason = 'ORIGINAL_COUPON_CONFLICT';
					$must_restore_originals = true;
				} elseif ( self::containsCode( $current, $recommended ) ) {
					$outcome = 'APPLIED';
				} else {
					$outcome = 'REJECTED';
					$reason = 'NOT_APPLICABLE';
					$must_restore_originals = self::containsCode( $current, $recommended );
				}
			}
		} elseif ( 'CHECKOUT_OFFERS' === $kind ) {
			$codes = self::groupCodes( $validatedOffer['offers'] ?? null );
			if ( null === $codes ) throw new \RuntimeException( 'restore_offer_contract_invalid' );
			$recommended = $codes[0] ?? null;
			if ( array() === $codes ) {
				$outcome = 'AUTOMATIC_NOT_FORCED';
			} else {
				foreach ( $codes as $code ) {
					$current_before_attempt = self::couponList( $cart->get_applied_coupons() );
					if ( null === $current_before_attempt ) throw new \RuntimeException( 'restore_offer_state_unavailable' );
					if ( self::containsCode( $current_before_attempt, $code ) ) continue;
					self::attempt( $cart, $code );
					$current = self::couponList( $cart->get_applied_coupons() );
					if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable' );
				}
				$current = self::couponList( $cart->get_applied_coupons() );
				if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable' );
				$originals_retained = self::containsAll( $current, $originals );
				$group_present = self::containsAll( $current, $codes );
				if ( ! $originals_retained ) {
					$outcome = 'CONFLICT_REQUIRES_CHOICE';
					$reason = 'GROUP_CONFLICT';
					$must_restore_originals = true;
				} elseif ( ! $group_present ) {
					$outcome = 'REJECTED';
					$reason = 'GROUP_REJECTED';
					$must_restore_originals = true;
				} elseif ( self::containsAll( $initial, $codes ) ) {
					$outcome = 'ALREADY_APPLIED';
				} else {
					$outcome = 'APPLIED';
				}
			}
		} else {
			throw new \RuntimeException( 'restore_offer_contract_invalid' );
		}

		if ( $must_restore_originals ) self::restoreOriginals( $cart, $originals );
		$final = self::couponList( $cart->get_applied_coupons() );
		if ( null === $final || ! self::containsAll( $final, $originals ) ) throw new \RuntimeException( 'restore_offer_original_rollback_failed' );
		$cart->calculate_totals();
		return array( 'outcome' => $outcome, 'recommendedCode' => $recommended, 'originalAppliedCodes' => $originals,
			'currentAppliedCodes' => $final, 'rejectionReason' => $reason, 'totalsRecalculated' => true );
	}

	private static function attempt( object $cart, string $code ): void {
		$suppress = static fn( mixed $message ): string => '';
		$installed = function_exists( 'add_filter' ) && function_exists( 'remove_filter' );
		if ( $installed ) add_filter( 'woocommerce_coupon_error', $suppress, PHP_INT_MAX, 3 );
		try {
			$cart->apply_coupon( $code );
		} finally {
			if ( $installed ) remove_filter( 'woocommerce_coupon_error', $suppress, PHP_INT_MAX );
		}
	}

	private static function restoreOriginals( object $cart, array $originals ): void {
		$current = self::couponList( $cart->get_applied_coupons() );
		if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable' );
		foreach ( $current as $code ) {
			if ( ! self::containsCode( $originals, $code ) ) $cart->remove_coupon( $code );
		}
		$current = self::couponList( $cart->get_applied_coupons() );
		if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable' );
		foreach ( $originals as $code ) {
			if ( ! self::containsCode( $current, $code ) ) {
				self::attempt( $cart, $code );
				$current = self::couponList( $cart->get_applied_coupons() );
				if ( null === $current || ! self::containsCode( $current, $code ) ) throw new \RuntimeException( 'restore_offer_original_rollback_failed' );
			}
		}
		if ( ! self::containsAll( $current, $originals ) ) throw new \RuntimeException( 'restore_offer_original_rollback_failed' );
	}

	private static function groupCodes( mixed $offers ): ?array {
		if ( ! is_array( $offers ) || ! array_is_list( $offers ) ) return null;
		$codes = array();
		foreach ( $offers as $item ) {
			if ( ! is_array( $item ) ) return null;
			if ( 'CODE' === ( $item['method'] ?? null ) ) {
				if ( ! is_string( $item['code'] ?? null ) || '' === $item['code'] ) return null;
				$codes[] = $item['code'];
			} elseif ( 'AUTOMATIC' !== ( $item['method'] ?? null ) ) return null;
		}
		return $codes;
	}

	private static function couponList( mixed $codes ): ?array {
		if ( ! is_array( $codes ) || ! array_is_list( $codes ) ) return null;
		foreach ( $codes as $code ) if ( ! is_string( $code ) || '' === $code ) return null;
		return $codes;
	}

	private static function containsAll( array $actual, array $expected ): bool {
		foreach ( $expected as $code ) if ( ! self::containsCode( $actual, $code ) ) return false;
		return true;
	}

	private static function containsCode( array $actual, string $expected ): bool {
		$expected = self::normalize( $expected );
		foreach ( $actual as $code ) if ( is_string( $code ) && self::normalize( $code ) === $expected ) return true;
		return false;
	}

	private static function normalize( string $code ): string {
		return function_exists( 'wc_format_coupon_code' ) ? wc_format_coupon_code( $code ) : strtolower( trim( $code ) );
	}
}
