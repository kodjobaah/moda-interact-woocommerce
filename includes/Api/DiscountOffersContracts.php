<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Strict, bounded host/API boundary: never relay arbitrary provider or tenant data. */
final class DiscountOffersContracts {
	private const MODES = array( 'NONE', 'FIXED', 'AI_BEST_APPLICABLE' );

	private static function exact( mixed $object, array $keys ): bool {
		if ( ! is_array( $object ) || array_is_list( $object ) ) return false;
		$actual = array_keys( $object );
		sort( $actual );
		sort( $keys );
		return $actual === $keys;
	}

	public static function id( mixed $value ): bool {
		return is_string( $value ) && preg_match( '/^[A-Za-z0-9_-]{1,128}$/D', $value ) === 1;
	}

	private static function ids( mixed $value ): bool {
		if ( ! is_array( $value ) || ! array_is_list( $value ) || count( $value ) > 50 ) return false;
		foreach ( $value as $id ) if ( ! self::id( $id ) ) return false;
		return count( $value ) === count( array_unique( $value ) );
	}

	public static function update( mixed $data ): bool {
		return self::exact( $data, array( 'recoveryOfferMode', 'selectedDiscountIds' ) ) &&
			in_array( $data['recoveryOfferMode'], self::MODES, true ) &&
			self::ids( $data['selectedDiscountIds'] ) &&
			( 'FIXED' !== $data['recoveryOfferMode'] || count( $data['selectedDiscountIds'] ) > 0 );
	}

	public static function offers( mixed $data ): bool {
		return self::exact( $data, array( 'schemaVersion', 'revision', 'merchant', 'effective', 'source', 'overrideActive' ) ) &&
			1 === $data['schemaVersion'] && is_string( $data['revision'] ) && strlen( $data['revision'] ) <= 1024 &&
			self::exact( $data['merchant'], array( 'recoveryOfferMode', 'selectedDiscountIds' ) ) &&
			in_array( $data['merchant']['recoveryOfferMode'], self::MODES, true ) &&
			self::ids( $data['merchant']['selectedDiscountIds'] ) &&
			self::exact( $data['effective'], array( 'recoveryOfferMode' ) ) &&
			in_array( $data['effective']['recoveryOfferMode'], self::MODES, true ) &&
			in_array( $data['source'], array( 'MERCHANT', 'ADMIN_OVERRIDE' ), true ) &&
			is_bool( $data['overrideActive'] ) &&
			$data['overrideActive'] === ( 'ADMIN_OVERRIDE' === $data['source'] );
	}

	private static function date( mixed $value ): bool {
		return null === $value || ( is_string( $value ) && strlen( $value ) <= 64 &&
			preg_match( '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/', $value ) === 1 );
	}

	public static function catalogue( mixed $data ): bool {
		if ( ! self::exact( $data, array( 'schemaVersion', 'revision', 'items', 'nextCursor', 'hasMore' ) ) ||
			1 !== $data['schemaVersion'] || ! is_string( $data['revision'] ) || strlen( $data['revision'] ) > 1024 ||
			! is_bool( $data['hasMore'] ) ||
			( null !== $data['nextCursor'] && ! self::id( $data['nextCursor'] ) ) ||
			$data['hasMore'] !== ( null !== $data['nextCursor'] ) ||
			! is_array( $data['items'] ) || ! array_is_list( $data['items'] ) || count( $data['items'] ) > 25 ) return false;
		foreach ( $data['items'] as $item ) {
			if ( ! self::exact( $item, array( 'id', 'title', 'summary', 'providerType', 'code', 'startsAt', 'endsAt', 'selected' ) ) ||
				! self::id( $item['id'] ) || ! is_string( $item['title'] ) || strlen( $item['title'] ) > 512 ||
				( null !== $item['summary'] && ( ! is_string( $item['summary'] ) || strlen( $item['summary'] ) > 2048 ) ) ||
				! in_array( $item['providerType'], array( 'WooCoupon:percent', 'WooCoupon:fixed_cart', 'WooCoupon:fixed_product' ), true ) ||
				( null !== $item['code'] && ( ! is_string( $item['code'] ) || strlen( $item['code'] ) > 256 ) ) ||
				! self::date( $item['startsAt'] ) || ! self::date( $item['endsAt'] ) || ! is_bool( $item['selected'] ) ) return false;
		}
		return ! $data['hasMore'] || count( $data['items'] ) > 0;
	}
}
