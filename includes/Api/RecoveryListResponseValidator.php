<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Strict allowlist at the hosted API -> merchant WordPress trust boundary. */
final class RecoveryListResponseValidator {
	private const STATUSES = array( 'DETECTED', 'MESSAGE_SENT', 'ENGAGED', 'COMPLETED', 'EXPIRED', 'CANCELLED' );
	private const FILTERS = array( 'all', 'ongoing', 'DETECTED', 'MESSAGE_SENT', 'ENGAGED', 'COMPLETED', 'EXPIRED', 'CANCELLED' );

	private static function exact( mixed $value, array $fields ): bool {
		if ( ! is_array( $value ) || array_is_list( $value ) ) return false;
		$actual = array_keys( $value );
		sort( $actual );
		sort( $fields );
		return $actual === $fields;
	}

	private static function textOrNull( mixed $value, int $max_length ): bool {
		return null === $value || ( is_string( $value ) && strlen( $value ) <= $max_length );
	}

	private static function timestamp( mixed $value ): bool {
		if ( ! is_string( $value ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $value ) ) return false;
		$date = \DateTimeImmutable::createFromFormat( '!Y-m-d\TH:i:s.v\Z', $value, new \DateTimeZone( 'UTC' ) );
		return false !== $date && $date->format( 'Y-m-d\TH:i:s.v\Z' ) === $value;
	}

	private static function item( mixed $item ): bool {
		if ( ! self::exact( $item, array( 'id', 'status', 'detectedAt', 'lastActivityAt', 'totalPrice', 'currency', 'customer' ) ) ) return false;
		if ( ! is_string( $item['id'] ) || ! preg_match( '/^[A-Za-z0-9_-]{1,191}$/D', $item['id'] ) ||
			! in_array( $item['status'], self::STATUSES, true ) || ! self::timestamp( $item['detectedAt'] ) ||
			! self::timestamp( $item['lastActivityAt'] ) ||
			( null !== $item['totalPrice'] && ( ! is_string( $item['totalPrice'] ) || ! preg_match( '/^-?\d{1,40}(?:\.\d{1,30})?$/D', $item['totalPrice'] ) ) ) ||
			( null !== $item['currency'] && ( ! is_string( $item['currency'] ) || ! preg_match( '/^[A-Z]{3}$/D', $item['currency'] ) ) ) ) return false;
		if ( null === $item['customer'] ) return true;
		return self::exact( $item['customer'], array( 'displayName', 'email' ) ) &&
			self::textOrNull( $item['customer']['displayName'], 160 ) &&
			self::textOrNull( $item['customer']['email'], 320 );
	}

	public static function isValid( mixed $payload ): bool {
		if ( ! self::exact( $payload, array( 'schemaVersion', 'timeZone', 'from', 'to', 'q', 'status', 'page', 'pageSize', 'total', 'totalPages', 'hasPrevious', 'hasNext', 'items' ) ) ||
			1 !== $payload['schemaVersion'] ||
			! is_string( $payload['timeZone'] ) || '' === $payload['timeZone'] || strlen( $payload['timeZone'] ) > 255 ||
			! is_string( $payload['from'] ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/D', $payload['from'] ) ||
			! is_string( $payload['to'] ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/D', $payload['to'] ) ||
			! is_string( $payload['q'] ) || strlen( $payload['q'] ) > 400 ||
			! in_array( $payload['status'], self::FILTERS, true ) ||
			! is_int( $payload['page'] ) || $payload['page'] < 1 || $payload['page'] > 9999 ||
			! in_array( $payload['pageSize'], array( 10, 20, 25, 50 ), true ) ||
			! is_int( $payload['total'] ) || $payload['total'] < 0 || $payload['total'] > 9007199254740991 ||
			! is_int( $payload['totalPages'] ) || $payload['totalPages'] !== max( 1, (int) ceil( $payload['total'] / $payload['pageSize'] ) ) ||
			$payload['page'] > $payload['totalPages'] ||
			! is_bool( $payload['hasPrevious'] ) || $payload['hasPrevious'] !== ( $payload['page'] > 1 ) ||
			! is_bool( $payload['hasNext'] ) || $payload['hasNext'] !== ( $payload['page'] < $payload['totalPages'] ) ||
			! is_array( $payload['items'] ) || ! array_is_list( $payload['items'] ) || count( $payload['items'] ) > $payload['pageSize'] ) return false;
		foreach ( $payload['items'] as $item ) {
			if ( ! self::item( $item ) ) return false;
		}
		return true;
	}
}
