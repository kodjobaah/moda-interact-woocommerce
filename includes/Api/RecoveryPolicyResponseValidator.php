<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Validates the complete API-002 merchant/effective policy response before browser exposure. */
final class RecoveryPolicyResponseValidator {
	private static function keys( array $value, array $expected ): bool {
		$actual = array_keys( $value );
		sort( $actual );
		sort( $expected );
		return $actual === $expected;
	}

	private static function values( mixed $value ): bool {
		if ( ! is_array( $value ) || ! self::keys( $value, array(
			'recoveryDelayMinutes', 'recoveryOfferMode', 'followUpEnabled', 'followUpDelayMinutes',
		) ) ) return false;
		if ( ! is_int( $value['recoveryDelayMinutes'] ) || $value['recoveryDelayMinutes'] < 0 ||
			$value['recoveryDelayMinutes'] > 10080 ||
			! in_array( $value['recoveryOfferMode'], array( 'NONE', 'FIXED', 'AI_BEST_APPLICABLE' ), true ) ||
			! is_bool( $value['followUpEnabled'] ) ) return false;
		return $value['followUpEnabled']
			? is_int( $value['followUpDelayMinutes'] ) && $value['followUpDelayMinutes'] >= 1 && $value['followUpDelayMinutes'] <= 10080
			: null === $value['followUpDelayMinutes'];
	}

	public static function isValid( mixed $data ): bool {
		return is_array( $data ) && self::keys( $data, array(
			'schemaVersion', 'revision', 'merchant', 'effective', 'source', 'overrideActive', 'offerSelectionAvailable', 'notifyOnInitialRecoveryOutreach',
		) ) && 2 === $data['schemaVersion'] && is_bool( $data['notifyOnInitialRecoveryOutreach'] ) && is_string( $data['revision'] ) &&
			( 'UNCONFIGURED' === $data['revision'] ||
				( 1 === preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $data['revision'] ) &&
				false !== strtotime( $data['revision'] ) ) ) &&
			self::values( $data['merchant'] ) && self::values( $data['effective'] ) &&
			in_array( $data['source'], array( 'MERCHANT', 'ADMIN_OVERRIDE' ), true ) &&
			is_bool( $data['overrideActive'] ) &&
			$data['overrideActive'] === ( 'ADMIN_OVERRIDE' === $data['source'] ) &&
			false === $data['offerSelectionAvailable'];
	}

	/** The Woo policy writes only delay and follow-up fields; never a provider coupon. */
	public static function isUpdate( mixed $data ): bool {
		if ( ! is_array( $data ) || ! self::keys( $data, array(
			'expectedRevision', 'recoveryDelayMinutes', 'followUpEnabled', 'followUpDelayMinutes', 'notifyOnInitialRecoveryOutreach',
		) ) ) return false;
		return self::isValid( array(
			'schemaVersion' => 2, 'revision' => $data['expectedRevision'],
			'merchant' => array(
				'recoveryDelayMinutes' => $data['recoveryDelayMinutes'], 'recoveryOfferMode' => 'NONE',
				'followUpEnabled' => $data['followUpEnabled'], 'followUpDelayMinutes' => $data['followUpDelayMinutes'],
			),
			'effective' => array(
				'recoveryDelayMinutes' => $data['recoveryDelayMinutes'], 'recoveryOfferMode' => 'NONE',
				'followUpEnabled' => $data['followUpEnabled'], 'followUpDelayMinutes' => $data['followUpDelayMinutes'],
			),
			'source' => 'MERCHANT', 'overrideActive' => false, 'offerSelectionAvailable' => false,
			'notifyOnInitialRecoveryOutreach' => $data['notifyOnInitialRecoveryOutreach'],
		) );
	}
}
