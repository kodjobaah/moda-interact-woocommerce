<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/WooRestoreOfferContracts.php';

final class WooRestoreResolveResponseValidator {
	public static function isValid( mixed $payload, string $recovery_id ): bool {
		if ( ! $payload instanceof \stdClass || ! self::hasExactKeys( $payload, array( 'schemaVersion', 'status', 'recoveryId', 'checkoutKey', 'snapshot', 'outreachOffer' ) ) ||
			'woo.restore.resolve.v1' !== $payload->schemaVersion || 'eligible' !== $payload->status ||
			$recovery_id !== $payload->recoveryId || ! self::identifier( $payload->recoveryId ) ||
			! self::identifier( $payload->checkoutKey ) || ! self::supportedSnapshot( $payload->snapshot ) ) {
			return false;
		}
		return WooRestoreOfferContracts::isValid( $payload->outreachOffer );
	}

	public static function toArray( mixed $value ): mixed {
		if ( $value instanceof \stdClass ) {
			$result = array();
			foreach ( get_object_vars( $value ) as $key => $item ) {
				$result[ $key ] = self::toArray( $item );
			}
			return $result;
		}
		if ( is_array( $value ) ) {
			return array_map( array( self::class, 'toArray' ), $value );
		}
		return $value;
	}

	private static function supportedSnapshot( mixed $snapshot ): bool {
		if ( ! $snapshot instanceof \stdClass || ! self::hasExactKeys( $snapshot, array( 'schemaVersion', 'kind', 'appliedCouponCodes', 'lines' ) ) ||
			'woo.cart-restore.v1' !== $snapshot->schemaVersion || 'supported' !== $snapshot->kind ||
			! self::textList( $snapshot->appliedCouponCodes, 10, 128 ) || ! is_array( $snapshot->lines ) ||
			array_is_list( $snapshot->lines ) === false || count( $snapshot->lines ) < 1 || count( $snapshot->lines ) > 50 ) {
			return false;
		}
		foreach ( $snapshot->lines as $line ) {
			if ( ! $line instanceof \stdClass ) return false;
			$keys = array_keys( get_object_vars( $line ) );
			if ( ! in_array( 'productId', $keys, true ) || ! in_array( 'quantity', $keys, true ) ||
				array_diff( $keys, array( 'productId', 'variationId', 'quantity', 'attributes' ) ) ||
				! self::positiveId( $line->productId ) || ! is_int( $line->quantity ) || $line->quantity < 1 || $line->quantity > 100000 ) {
				return false;
			}
			if ( property_exists( $line, 'variationId' ) && ! self::positiveId( $line->variationId ) ) return false;
			if ( property_exists( $line, 'attributes' ) ) {
				if ( ! $line->attributes instanceof \stdClass || count( get_object_vars( $line->attributes ) ) > 10 ) return false;
				foreach ( get_object_vars( $line->attributes ) as $key => $value ) {
					if ( ! self::text( $key, 80 ) || ! self::text( $value, 200 ) ) return false;
				}
			}
		}
		return true;
	}

	private static function hasExactKeys( \stdClass $value, array $expected ): bool {
		$actual = array_keys( get_object_vars( $value ) );
		sort( $actual );
		sort( $expected );
		return $actual === $expected;
	}

	private static function identifier( mixed $value ): bool {
		return is_string( $value ) && strlen( $value ) <= 128 && 1 === preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/D', $value );
	}

	private static function positiveId( mixed $value ): bool {
		return is_string( $value ) && strlen( $value ) <= 20 && 1 === preg_match( '/^[1-9][0-9]*$/D', $value );
	}

	private static function textList( mixed $value, int $maximum_items, int $maximum_text ): bool {
		if ( ! is_array( $value ) || ! array_is_list( $value ) || count( $value ) > $maximum_items ) return false;
		foreach ( $value as $item ) if ( ! self::text( $item, $maximum_text ) ) return false;
		return true;
	}

	private static function text( mixed $value, int $maximum ): bool {
		if ( ! is_string( $value ) || '' === $value || false === preg_match_all( '/./us', $value, $matches ) ||
			count( $matches[0] ) > $maximum || 1 === preg_match( '/\p{Cc}/u', $value ) ) return false;
		return true;
	}
}
