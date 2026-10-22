<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Fail-closed validation of the API-022 read-only merchant usage projection. */
final class UsageHistoryResponseValidator {
	private const PAGE_SIZES = array( 10, 25, 50, 100 );
	private const MAX_SAFE_INTEGER = 9007199254740991;

	private static function exact( mixed $value, array $keys ): bool {
		if ( ! is_array( $value ) || ( array() !== $value && array_is_list( $value ) ) ) return false;
		$actual = array_keys( $value );
		sort( $actual );
		sort( $keys );
		return $actual === $keys;
	}

	private static function id( mixed $value, int $max = 128 ): bool {
		return is_string( $value ) && strlen( $value ) <= $max &&
			1 === preg_match( '/^[A-Za-z0-9_-]+$/D', $value );
	}

	private static function cursor( mixed $value ): bool {
		return null === $value || self::id( $value, 1024 );
	}

	private static function timestamp( mixed $value ): bool {
		if ( ! is_string( $value ) || strlen( $value ) > 45 ||
			! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/D', $value ) ) return false;
		$parsed = date_parse( $value );
		return 0 === $parsed['error_count'] && 0 === $parsed['warning_count'];
	}

	private static function quantity( mixed $value, bool $signed = false ): bool {
		return is_int( $value ) && $value <= self::MAX_SAFE_INTEGER &&
			$value >= ( $signed ? -self::MAX_SAFE_INTEGER : 0 );
	}

	private static function period( mixed $value ): bool {
		return self::exact( $value, array( 'id', 'periodStart', 'periodEnd' ) ) &&
			self::id( $value['id'] ) && self::timestamp( $value['periodStart'] ) &&
			self::timestamp( $value['periodEnd'] ) &&
			strtotime( $value['periodStart'] ) < strtotime( $value['periodEnd'] );
	}

	private const CHARGE_SOURCES = array(
		'LIFETIME_FREE_CREDITS', 'INCLUDED_PLAN_ALLOWANCE', 'PURCHASED_TOP_UP',
		'PROMOTIONAL_CREDITS', 'NOT_APPLICABLE', 'UNATTRIBUTED',
	);

	private static function event( mixed $value, int $version ): bool {
		$keys = array( 'id', 'metric', 'quantity', 'occurredAt', 'sourceRecovery' );
		if ( 2 === $version ) $keys[] = 'chargedAgainst';
		if ( ! self::exact( $value, $keys ) ||
			! self::id( $value['id'], 191 ) || ! is_string( $value['metric'] ) ||
			! preg_match( '/^[A-Z][A-Z0-9_]{0,63}$/D', $value['metric'] ) ||
			( 2 === $version && ! in_array( $value['metric'], array(
				'RECOVERY_CONVERSATION', 'OUTBOUND_AUTOMATED_MESSAGE',
				'DELIVERED_WHATSAPP_MESSAGE', 'RECOVERY_CREDIT_PACK_PURCHASE',
			), true ) ) ||
			! self::quantity( $value['quantity'], true ) || ! self::timestamp( $value['occurredAt'] ) ||
			( 2 === $version && ! in_array( $value['chargedAgainst'], self::CHARGE_SOURCES, true ) ) ) return false;
		$source = $value['sourceRecovery'];
		if ( null === $source ) return true;
		return self::exact( $source, array( 'recoveryId', 'customerName' ) ) &&
			self::id( $source['recoveryId'], 191 ) &&
			( null === $source['customerName'] || (
				is_string( $source['customerName'] ) && strlen( $source['customerName'] ) <= 512 &&
				1 === preg_match( '//u', $source['customerName'] ) &&
				! preg_match( '/[\x00-\x1F\x7F]/', $source['customerName'] )
			) );
	}

	public static function isValid( mixed $value ): bool {
		if ( ! self::exact( $value, array( 'schemaVersion', 'state', 'usageView', 'periodPage', 'usageEvents', 'usagePagination' ) ) ||
			! in_array( $value['schemaVersion'], array( 1, 2 ), true ) ||
			! in_array( $value['state'], array( 'ready', 'unavailable' ), true ) ||
			! in_array( $value['usageView'], array( 'current', 'past' ), true ) ) return false;
		$periods = $value['periodPage'];
		if ( ! self::exact( $periods, array( 'items', 'previousCursor', 'nextCursor' ) ) ||
			! is_array( $periods['items'] ) || ! array_is_list( $periods['items'] ) || count( $periods['items'] ) > 25 ||
			! self::cursor( $periods['previousCursor'] ) || ! self::cursor( $periods['nextCursor'] ) ) return false;
		foreach ( $periods['items'] as $period ) if ( ! self::period( $period ) ) return false;
		$page = $value['usagePagination'];
		if ( ! self::exact( $page, array( 'page', 'pageSize', 'total', 'totalQuantity', 'billId', 'periodStart', 'periodEnd' ) ) ||
			! is_int( $page['page'] ) || $page['page'] < 1 || $page['page'] > 1000 ||
			! in_array( $page['pageSize'], self::PAGE_SIZES, true ) ||
			! self::quantity( $page['total'] ) || ! self::quantity( $page['totalQuantity'], true ) ||
			( null !== $page['billId'] && ! self::id( $page['billId'] ) ) ||
			( null !== $page['periodStart'] && ! self::timestamp( $page['periodStart'] ) ) ||
			( null !== $page['periodEnd'] && ! self::timestamp( $page['periodEnd'] ) ) ||
			( ( null === $page['periodStart'] ) !== ( null === $page['periodEnd'] ) ) ||
			! is_array( $value['usageEvents'] ) || ! array_is_list( $value['usageEvents'] ) ||
			count( $value['usageEvents'] ) > $page['pageSize'] || count( $value['usageEvents'] ) > $page['total'] ) return false;
		foreach ( $value['usageEvents'] as $event ) if ( ! self::event( $event, $value['schemaVersion'] ) ) return false;
		return true;
	}
}
