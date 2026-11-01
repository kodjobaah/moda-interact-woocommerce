<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Records only bounded, private outcomes from restored original coupons. */
final class CheckoutCouponOutcomeHandler {
	/** @param mixed $result CheckoutCartRestorer result. */
	public function handle( mixed $result ): string {
		if ( ! is_array( $result ) || ! is_array( $result['appliedCodes'] ?? null ) ||
			! is_array( $result['rejectedCodes'] ?? null ) || true !== ( $result['cartTotalRecalculated'] ?? null ) ||
			! self::validCodeList( $result['appliedCodes'] ) || ! self::validCodeList( $result['rejectedCodes'] ) ) {
			self::record( 'unknown', 0, 0 );
			return 'unknown';
		}

		$applied_count = count( $result['appliedCodes'] );
		$rejected_count = count( $result['rejectedCodes'] );
		if ( 0 === $applied_count && 0 === $rejected_count ) {
			self::record( 'unknown', 0, 0 );
			return 'unknown';
		}
		if ( 0 < $rejected_count ) {
			self::record( 'rejected', $applied_count, $rejected_count );
			return 'rejected';
		}
		self::record( 'applied', $applied_count, 0 );
		return 'applied';
	}

	private static function validCodeList( array $codes ): bool {
		if ( ! array_is_list( $codes ) || count( $codes ) > 10 ) return false;
		foreach ( $codes as $code ) {
			if ( ! is_string( $code ) || '' === $code ) return false;
		}
		return true;
	}

	private static function record( string $outcome, int $applied_count, int $rejected_count ): void {
		$details = sprintf( 'outcome=%s;applied_count=%d;rejected_count=%d;totals=recalculated', $outcome, $applied_count, $rejected_count );
		CheckoutDiagnosticLogger::record( 'checkout_coupon_restore', 'coupon_restore_outcome', new \RuntimeException( $details ) );
	}
}
