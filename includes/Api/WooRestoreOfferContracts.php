<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Strict parser for the mandatory offer union in woo.restore.resolve.v1. */
final class WooRestoreOfferContracts {
	public static function isValid( mixed $offer ): bool {
		if ( ! $offer instanceof \stdClass || ! isset( $offer->kind ) || ! is_string( $offer->kind ) ) return false;
		switch ( $offer->kind ) {
			case 'NONE':
				return self::hasExactKeys( $offer, array( 'kind', 'reason' ) ) &&
					in_array( $offer->reason, array( 'NO_CONFIRMED_OFFER', 'UNVERIFIABLE' ), true );
			case 'CHECKOUT_CODE':
				return self::hasExactKeys( $offer, array( 'kind', 'code', 'providerDiscountId' ) ) &&
					self::text( $offer->code, 128 ) && self::text( $offer->providerDiscountId, 191 );
			case 'CHECKOUT_AUTOMATIC':
				return self::hasExactKeys( $offer, array( 'kind', 'providerDiscountId' ) ) && self::text( $offer->providerDiscountId, 191 );
			case 'CHECKOUT_OFFERS':
				if ( ! self::hasExactKeys( $offer, array( 'kind', 'offers' ) ) || ! is_array( $offer->offers ) ||
					! array_is_list( $offer->offers ) || count( $offer->offers ) < 2 || count( $offer->offers ) > 3 ) return false;
				foreach ( $offer->offers as $item ) {
					if ( ! $item instanceof \stdClass || ! isset( $item->method ) ) return false;
					if ( 'CODE' === $item->method ) {
						if ( ! self::hasExactKeys( $item, array( 'method', 'code', 'providerDiscountId' ) ) ||
							! self::text( $item->code, 128 ) || ! self::text( $item->providerDiscountId, 191 ) ) return false;
					} elseif ( 'AUTOMATIC' === $item->method ) {
						if ( ! self::hasExactKeys( $item, array( 'method', 'providerDiscountId' ) ) || ! self::text( $item->providerDiscountId, 191 ) ) return false;
					} else return false;
				}
				return true;
			case 'ALTERNATIVE_PRODUCT':
				return self::hasExactKeys( $offer, array( 'kind' ) );
		}
		return false;
	}

	private static function hasExactKeys( \stdClass $value, array $expected ): bool {
		$actual = array_keys( get_object_vars( $value ) );
		sort( $actual );
		sort( $expected );
		return $actual === $expected;
	}

	private static function text( mixed $value, int $maximum ): bool {
		return is_string( $value ) && '' !== $value && false !== preg_match_all( '/./us', $value, $matches ) &&
			count( $matches[0] ) <= $maximum && 1 !== preg_match( '/\p{Cc}/u', $value );
	}
}
