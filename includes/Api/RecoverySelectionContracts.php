<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** The hosted API-005 contract; no customer or tenant identifiers travel to the browser. */
final class RecoverySelectionContracts {
	public const VERSION = 'woo.customer-recovery-selection.v1';

	public static function phone( mixed $phone ): bool {
		return is_string( $phone ) && 1 === preg_match( '/^[1-9][0-9]{1,14}$/D', $phone );
	}

	public static function revision( mixed $revision ): bool {
		return is_string( $revision ) && 1 === preg_match( '/^(0|[1-9][0-9]{0,18})$/D', $revision );
	}

	public static function command( mixed $input ): bool {
		if ( ! self::keys( $input, array( 'schemaVersion', 'canonicalPhone', 'action', 'expectedNoContactRevision', 'evidenceReference' ) ) ||
			self::VERSION !== $input['schemaVersion'] || ! self::phone( $input['canonicalPhone'] ) ||
			! self::revision( $input['expectedNoContactRevision'] ) ||
			! in_array( $input['action'], array( 'SUPPRESS', 'REENABLE', 'RECORD_CUSTOMER_STOP' ), true ) ) {
			return false;
		}
		if ( 'RECORD_CUSTOMER_STOP' === $input['action'] ) {
			return is_string( $input['evidenceReference'] ) &&
				1 === preg_match( '/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/D', $input['evidenceReference'] );
		}
		return null === $input['evidenceReference'];
	}

	public static function status( mixed $payload, bool $command = false ): bool {
		$keys = array( 'schemaVersion', 'consentDecision', 'suppressed', 'suppressionReason', 'noContactRevision', 'phoneEligibleForRecovery', 'canReenable' );
		if ( $command ) $keys[] = 'outcome';
		if ( ! self::keys( $payload, $keys ) || self::VERSION !== $payload['schemaVersion'] ||
			! in_array( $payload['consentDecision'], array( 'UNKNOWN', 'GRANTED', 'REVOKED' ), true ) ||
			! is_bool( $payload['suppressed'] ) ||
			! in_array( $payload['suppressionReason'], array( null, 'MERCHANT_OPT_OUT', 'CUSTOMER_STOP' ), true ) ||
			! self::revision( $payload['noContactRevision'] ) ||
			! is_bool( $payload['phoneEligibleForRecovery'] ) || ! is_bool( $payload['canReenable'] ) ||
			$payload['suppressed'] !== ( null !== $payload['suppressionReason'] ) ||
			( $payload['phoneEligibleForRecovery'] && ( $payload['suppressed'] || 'GRANTED' !== $payload['consentDecision'] ) ) ||
			( $payload['canReenable'] && ( 'MERCHANT_OPT_OUT' !== $payload['suppressionReason'] || 'GRANTED' !== $payload['consentDecision'] ) ) ) {
			return false;
		}
		return ! $command || in_array( $payload['outcome'], array( 'updated', 'duplicate' ), true );
	}

	private static function keys( mixed $input, array $keys ): bool {
		if ( ! is_array( $input ) || array_is_list( $input ) ) return false;
		$actual = array_keys( $input );
		sort( $actual );
		sort( $keys );
		return $actual === $keys;
	}
}
