<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Applies only confirmed outreach codes through Woo's current coupon rules. */
final class CheckoutOutreachCouponRestorer {
	/** @return array{outcome:string,recommendedCode:?string,recommendedCodes:list<string>,choiceAvailable:bool,originalAppliedCodes:list<string>,currentAppliedCodes:list<string>,rejectionReason:?string,totalsRecalculated:bool} */
	public function apply_outreach_offer( array $validatedOffer, array $appliedOriginalCoupons, \WC_Cart $cart ): array {
		if ( ! method_exists( $cart, 'get_applied_coupons' ) || ! method_exists( $cart, 'apply_coupon' ) ||
			! method_exists( $cart, 'remove_coupon' ) || ! method_exists( $cart, 'calculate_totals' ) ) {
			throw new \RuntimeException( 'restore_offer_cart_unavailable' );
		}
		$initial = self::cartCouponList( $cart );
		$originals = self::couponList( $appliedOriginalCoupons );
		if ( null === $initial || null === $originals || ! self::containsAll( $initial, $originals ) ) {
			throw new \RuntimeException( 'restore_offer_original_state_unavailable' );
		}

		$kind = $validatedOffer['kind'] ?? null;
		$recommended = null;
		$recommended_codes = array();
		$choice_available = false;
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
			$recommended_codes = array( $recommended );
			if ( self::containsCode( $initial, $recommended ) ) {
				$outcome = 'ALREADY_APPLIED';
			} else {
				self::attempt( $cart, $recommended );
				$current = self::cartCouponList( $cart );
				if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable' );
				if ( ! self::containsAll( $current, $originals ) ) {
					$outcome = 'CONFLICT_REQUIRES_CHOICE';
					$reason = 'ORIGINAL_COUPON_CONFLICT';
					$must_restore_originals = true;
					$choice_available = true;
				} elseif ( self::containsCode( $current, $recommended ) ) {
					$outcome = 'APPLIED';
				} else {
					// Woo may reject a valid alternative while preserving an
					// individual-use original coupon. Probe the alternative alone
					// below before deciding whether to expose a safe switch choice.
					$outcome = 'CONFLICT_REQUIRES_CHOICE';
					$reason = 'ORIGINAL_COUPON_CONFLICT';
					$must_restore_originals = true;
					$choice_available = true;
				}
			}
		} elseif ( 'CHECKOUT_OFFERS' === $kind ) {
			$codes = self::groupCodes( $validatedOffer['offers'] ?? null );
			if ( null === $codes ) throw new \RuntimeException( 'restore_offer_contract_invalid' );
			$recommended_codes = $codes;
			$recommended = $codes[0] ?? null;
			if ( array() === $codes ) {
				$outcome = 'AUTOMATIC_NOT_FORCED';
			} else {
				foreach ( $codes as $code ) {
					$current_before_attempt = self::cartCouponList( $cart );
					if ( null === $current_before_attempt ) throw new \RuntimeException( 'restore_offer_state_unavailable_before_group_code' );
					if ( self::containsCode( $current_before_attempt, $code ) ) continue;
					self::attempt( $cart, $code );
					$current = self::cartCouponList( $cart );
					if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable_after_group_code' );
				}
				$current = self::cartCouponList( $cart );
				if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable_after_group' );
				$originals_retained = self::containsAll( $current, $originals );
				$group_present = self::containsAll( $current, $codes );
				if ( ! $originals_retained ) {
					$outcome = 'CONFLICT_REQUIRES_CHOICE';
					$reason = 'GROUP_CONFLICT';
					$must_restore_originals = true;
					$offers = $validatedOffer['offers'] ?? array();
					$choice_available = count( $codes ) > 0 && count( $offers ) === count( $codes );
				} elseif ( ! $group_present ) {
					$outcome = 'CONFLICT_REQUIRES_CHOICE';
					$reason = 'GROUP_CONFLICT';
					$must_restore_originals = true;
					$choice_available = count( $codes ) > 0 && count( $validatedOffer['offers'] ?? array() ) === count( $codes );
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
		if ( $choice_available ) {
			$choice_available = self::canApplyChoiceSetAlone( $cart, $recommended_codes, $originals );
			if ( ! $choice_available ) {
				$outcome = 'REJECTED';
				$reason = in_array( $reason, array( 'GROUP_CONFLICT', 'GROUP_REJECTED' ), true ) ? 'GROUP_REJECTED' : 'NOT_APPLICABLE';
			}
		}
		$final = self::cartCouponList( $cart );
		if ( null === $final || ! self::containsAll( $final, $originals ) ) throw new \RuntimeException( 'restore_offer_original_rollback_failed' );
		$cart->calculate_totals();
		return array( 'outcome' => $outcome, 'recommendedCode' => $recommended, 'recommendedCodes' => $recommended_codes,
			'choiceAvailable' => $choice_available, 'originalAppliedCodes' => $originals,
			'currentAppliedCodes' => $final, 'rejectionReason' => $reason, 'totalsRecalculated' => true );
	}

	private static function attempt( object $cart, string $code ): void {
		$suppress = static fn( mixed $message ): string => '';
		$installed = function_exists( 'add_filter' ) && function_exists( 'remove_filter' );
		$notices = function_exists( 'wc_get_notices' ) ? wc_get_notices() : null;
		if ( $installed ) add_filter( 'woocommerce_coupon_error', $suppress, PHP_INT_MAX, 3 );
		try {
			$cart->apply_coupon( $code );
		} finally {
			if ( $installed ) remove_filter( 'woocommerce_coupon_error', $suppress, PHP_INT_MAX );
			if ( is_array( $notices ) && function_exists( 'wc_set_notices' ) ) wc_set_notices( $notices );
		}
	}

	private static function restoreOriginals( object $cart, array $originals ): void {
		$current = self::cartCouponList( $cart );
		if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable_before_offer_rollback' );
		foreach ( $current as $code ) {
			if ( ! self::containsCode( $originals, $code ) ) $cart->remove_coupon( $code );
		}
		$current = self::cartCouponList( $cart );
		if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable_after_offer_removal' );
		foreach ( $originals as $code ) {
			if ( ! self::containsCode( $current, $code ) ) {
				self::attempt( $cart, $code );
				$current = self::cartCouponList( $cart );
				if ( null === $current ) throw new \RuntimeException( 'restore_offer_state_unavailable_after_original_reapply' );
				if ( ! self::containsCode( $current, $code ) ) throw new \RuntimeException( 'restore_offer_original_reapply_rejected' );
			}
		}
		if ( ! self::containsAll( $current, $originals ) ) throw new \RuntimeException( 'restore_offer_original_set_incomplete' );
	}

	/** Verify the alternate set is valid by itself, then restore the original default. */
	private static function canApplyChoiceSetAlone( object $cart, array $codes, array $originals ): bool {
		if ( array() === $codes || count( $codes ) > 3 || count( array_unique( array_map( self::normalize( ... ), $codes ) ) ) !== count( $codes ) ) return false;
		$valid = false;
		try {
			$current = self::cartCouponList( $cart );
			if ( null === $current || ! self::containsAll( $current, $originals ) ) throw new \RuntimeException( 'restore_offer_choice_state_unavailable' );
			foreach ( $current as $code ) $cart->remove_coupon( $code );
			foreach ( $codes as $code ) self::attempt( $cart, $code );
			$alternate = self::cartCouponList( $cart );
			$valid = null !== $alternate && count( $alternate ) === count( $codes ) && self::containsAll( $alternate, $codes );
		} catch ( \Throwable $error ) {
			CheckoutDiagnosticLogger::record( 'checkout_coupon_restore', 'offer_choice_validation_failed', $error, self::safeChoiceErrorMessage( $error, $codes, $originals ) );
		} finally {
			self::restoreOriginals( $cart, $originals );
			$cart->calculate_totals();
		}
		return $valid;
	}

	/** Retain the dependency failure while explicitly removing all involved coupons. */
	private static function safeChoiceErrorMessage( \Throwable $error, array $codes, array $originals ): string {
		$message = $error->getMessage();
		foreach ( array_merge( $codes, $originals ) as $code ) {
			if ( is_string( $code ) && '' !== $code ) $message = str_ireplace( $code, '[redacted-coupon]', $message );
		}
		return $message;
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

	/** Woo removal can leave sparse numeric keys in the live applied-code list. */
	private static function cartCouponList( object $cart ): ?array {
		$codes = $cart->get_applied_coupons();
		if ( ! is_array( $codes ) ) return null;
		$values = self::couponList( array_values( $codes ) );
		if ( null !== $values ) return $values;
		if ( ! array_is_list( $codes ) ) {
			$keys = array();
			foreach ( array_keys( $codes ) as $code ) {
				if ( ( ! is_string( $code ) && ! is_int( $code ) ) || '' === (string) $code ) return null;
				$keys[] = (string) $code;
			}
			return $keys;
		}
		return self::couponList( $codes );
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
