<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** API-021 response allowlist. Never forward unchecked hosted JSON into merchant admin. */
final class PromotionsResponseValidator {
	private const HISTORY_STATUSES = array( 'SELECTED', 'USED', 'EXHAUSTED', 'EXPIRED', 'CLOSED', 'NO_LONGER_ELIGIBLE', 'REOPENED' );

	private static function exact( mixed $value, array $keys ): bool {
		if ( ! is_array( $value ) || array_is_list( $value ) ) return false;
		$actual = array_keys( $value );
		sort( $actual );
		sort( $keys );
		return $actual === $keys;
	}

	private static function id( mixed $value ): bool {
		return is_string( $value ) && 1 === preg_match( '/^[A-Za-z0-9_-]{1,128}$/D', $value );
	}

	public static function revision( mixed $value ): bool {
		return is_string( $value ) && 1 === preg_match( '/^[a-f0-9]{64}$/D', $value );
	}

	private static function text( mixed $value, int $max, bool $nonempty = false ): bool {
		if ( ! is_string( $value ) || ! preg_match( '//u', $value ) ) return false;
		$length = preg_match_all( '/./us', $value );
		return false !== $length && $length <= $max && ( ! $nonempty || $length > 0 );
	}

	private static function count( mixed $value ): bool {
		return is_int( $value ) && $value >= 0 && $value <= 9007199254740991;
	}

	private static function date( mixed $value ): bool {
		if ( ! is_string( $value ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $value ) ) return false;
		$date = \DateTimeImmutable::createFromFormat( '!Y-m-d\TH:i:s.v\Z', $value, new \DateTimeZone( 'UTC' ) );
		return false !== $date && $date->format( 'Y-m-d\TH:i:s.v\Z' ) === $value;
	}

	private static function pagination( mixed $page ): bool {
		return self::exact( $page, array( 'page', 'pageSize', 'totalEntries', 'totalPages' ) ) &&
			is_int( $page['page'] ) && $page['page'] >= 1 && $page['page'] <= 1000 &&
			6 === $page['pageSize'] && self::count( $page['totalEntries'] ) &&
			is_int( $page['totalPages'] ) && $page['totalPages'] === max( 1, (int) ceil( $page['totalEntries'] / 6 ) ) &&
			$page['page'] <= $page['totalPages'];
	}

	private static function offer( mixed $offer ): bool {
		if ( ! self::exact( $offer, array( 'id', 'merchantTitle', 'merchantDescription', 'quantity', 'expiresAt', 'remainingQuantity',
			'exhausted', 'previouslyClaimed', 'currentlySelected', 'eligible', 'selectable' ) ) ) return false;
		if ( ! self::id( $offer['id'] ) || ! self::text( $offer['merchantTitle'], 255, true ) ||
			! self::text( $offer['merchantDescription'], 10000 ) || ! self::count( $offer['quantity'] ) ||
			! self::count( $offer['remainingQuantity'] ) || $offer['remainingQuantity'] > $offer['quantity'] ||
			! self::date( $offer['expiresAt'] ) ) return false;
		foreach ( array( 'exhausted', 'previouslyClaimed', 'currentlySelected', 'eligible', 'selectable' ) as $key ) {
			if ( ! is_bool( $offer[ $key ] ) ) return false;
		}
		return true;
	}

	private static function selection( mixed $selection ): bool {
		if ( ! self::exact( $selection, array( 'campaignId', 'merchantTitle', 'remainingQuantity', 'quantityGranted',
			'reservedQuantity', 'committedQuantity', 'expiresAt', 'locked', 'exhausted', 'campaignStatus',
			'targetEligible', 'spendable' ) ) ) return false;
		if ( ! self::id( $selection['campaignId'] ) || ! self::text( $selection['merchantTitle'], 255, true ) ||
			! self::date( $selection['expiresAt'] ) || ! in_array( $selection['campaignStatus'], array( 'DRAFT', 'ACTIVE', 'CLOSED' ), true ) ) return false;
		foreach ( array( 'remainingQuantity', 'quantityGranted', 'reservedQuantity', 'committedQuantity' ) as $key ) {
			if ( ! self::count( $selection[ $key ] ) ) return false;
		}
		if ( $selection['remainingQuantity'] + $selection['reservedQuantity'] + $selection['committedQuantity'] !== $selection['quantityGranted'] ) return false;
		foreach ( array( 'locked', 'exhausted', 'targetEligible', 'spendable' ) as $key ) {
			if ( ! is_bool( $selection[ $key ] ) ) return false;
		}
		return true;
	}

	private static function historyEntry( mixed $entry ): bool {
		if ( ! self::exact( $entry, array( 'campaignId', 'campaignTitle', 'status', 'quantityGranted',
			'committedQuantity', 'remainingQuantity', 'lastSelectedAt', 'expiresAt' ) ) ) return false;
		if ( ! self::id( $entry['campaignId'] ) || ! self::text( $entry['campaignTitle'], 255, true ) ||
			! in_array( $entry['status'], self::HISTORY_STATUSES, true ) ||
			! self::date( $entry['expiresAt'] ) || ( null !== $entry['lastSelectedAt'] && ! self::date( $entry['lastSelectedAt'] ) ) ) return false;
		foreach ( array( 'quantityGranted', 'committedQuantity', 'remainingQuantity' ) as $key ) {
			if ( ! self::count( $entry[ $key ] ) ) return false;
		}
		return $entry['committedQuantity'] + $entry['remainingQuantity'] <= $entry['quantityGranted'];
	}

	public static function read( mixed $payload ): bool {
		if ( ! self::exact( $payload, array( 'schemaVersion', 'revision', 'offers', 'offersPagination', 'selection', 'history' ) ) ||
			1 !== $payload['schemaVersion'] || ! self::revision( $payload['revision'] ) ||
			! is_array( $payload['offers'] ) || ! array_is_list( $payload['offers'] ) || count( $payload['offers'] ) > 6 ||
			! self::pagination( $payload['offersPagination'] ) ||
			( null !== $payload['selection'] && ! self::selection( $payload['selection'] ) ) ||
			! self::exact( $payload['history'], array( 'entries', 'page', 'pageSize', 'totalEntries', 'totalPages' ) ) ) return false;
		$history = $payload['history'];
		$pagination = array_diff_key( $history, array( 'entries' => true ) );
		if ( ! self::pagination( $pagination ) || ! is_array( $history['entries'] ) ||
			! array_is_list( $history['entries'] ) || count( $history['entries'] ) > 6 ) return false;
		$ids = array();
		foreach ( $payload['offers'] as $offer ) {
			if ( ! self::offer( $offer ) || in_array( $offer['id'], $ids, true ) ) return false;
			$ids[] = $offer['id'];
		}
		$ids = array();
		foreach ( $history['entries'] as $entry ) {
			if ( ! self::historyEntry( $entry ) || in_array( $entry['campaignId'], $ids, true ) ) return false;
			$ids[] = $entry['campaignId'];
		}
		return true;
	}

	public static function selected( mixed $payload ): bool {
		return self::exact( $payload, array( 'schemaVersion', 'revision', 'selection' ) ) &&
			1 === $payload['schemaVersion'] && self::revision( $payload['revision'] ) &&
			self::selection( $payload['selection'] );
	}
}
