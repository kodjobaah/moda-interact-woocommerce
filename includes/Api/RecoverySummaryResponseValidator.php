<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Strict, bounded validation at the hosted-API-to-WordPress boundary. */
final class RecoverySummaryResponseValidator {
	public static function isValid( mixed $data ): bool {
		if ( ! is_array( $data ) || array_is_list( $data ) ) {
			return false;
		}
		$keys = array_keys( $data );
		$expected = array( 'schemaVersion', 'recoveryDelayMinutes', 'recoveryOfferMode', 'followUpEnabled', 'followUpDelayMinutes', 'source' );
		sort( $keys );
		sort( $expected );
		if ( $keys !== $expected || 1 !== $data['schemaVersion'] ||
			! is_int( $data['recoveryDelayMinutes'] ) ||
			$data['recoveryDelayMinutes'] < 0 || $data['recoveryDelayMinutes'] > 10080 ||
			! in_array( $data['recoveryOfferMode'], array( 'NONE', 'FIXED', 'AI_BEST_APPLICABLE' ), true ) ||
			! is_bool( $data['followUpEnabled'] ) ||
			! in_array( $data['source'], array( 'MERCHANT', 'ADMIN_OVERRIDE' ), true ) ) {
			return false;
		}
		$delay = $data['followUpDelayMinutes'];
		return $data['followUpEnabled']
			? is_int( $delay ) && 1 <= $delay && 10080 >= $delay
			: null === $delay;
	}
}
