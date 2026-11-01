<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Strict validator for the Shared v1 merchant AI-response-delay wire contract. */
final class AiResponseDelayResponseValidator {
	private static function exactKeys( array $value, array $expected ): bool {
		$actual = array_keys( $value );
		sort( $actual );
		sort( $expected );
		return $actual === $expected;
	}

	private static function revision( mixed $value ): bool {
		if ( ! is_string( $value ) ) return false;
		if ( 'UNCONFIGURED' === $value ) return true;
		if ( 1 !== preg_match( '/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/D', $value ) ) return false;
		$date = \DateTimeImmutable::createFromFormat( '!Y-m-d\TH:i:s.v\Z', $value, new \DateTimeZone( 'UTC' ) );
		return false !== $date && false === \DateTimeImmutable::getLastErrors() &&
			$value === $date->format( 'Y-m-d\TH:i:s.v\Z' );
	}

	private static function minutes( mixed $value ): bool {
		return is_int( $value ) && $value >= 0 && $value <= 30;
	}

	public static function isValid( mixed $data ): bool {
		return is_array( $data ) && self::exactKeys( $data, array(
			'schemaVersion', 'revision', 'aiResponseDelayMinutes',
		) ) && 1 === $data['schemaVersion'] && self::revision( $data['revision'] ) &&
			self::minutes( $data['aiResponseDelayMinutes'] );
	}

	public static function isUpdate( mixed $data ): bool {
		return is_array( $data ) && self::exactKeys( $data, array(
			'schemaVersion', 'expectedRevision', 'aiResponseDelayMinutes',
		) ) && 1 === $data['schemaVersion'] && self::revision( $data['expectedRevision'] ) &&
			self::minutes( $data['aiResponseDelayMinutes'] );
	}
}
