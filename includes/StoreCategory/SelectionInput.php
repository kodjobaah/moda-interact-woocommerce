<?php

namespace ModaInteract\WooCommerce\StoreCategory;

defined( 'ABSPATH' ) || exit;

/** Rejects extra keys and browser-supplied identities before contacting Moda. */
final class SelectionInput {
	public static function parse( mixed $input ): ?array {
		if ( ! is_array( $input ) || array_is_list( $input ) ) {
			return null;
		}
		$keys = array_keys( $input );
		$expected = array( 'schemaVersion', 'categoryId', 'selectedMappingIds', 'expectedPendingSelectionGeneration' );
		sort( $keys );
		sort( $expected );
		if ( $keys !== $expected || 1 !== $input['schemaVersion'] ||
			! self::validId( $input['categoryId'] ) ||
			! is_array( $input['selectedMappingIds'] ) || ! array_is_list( $input['selectedMappingIds'] ) ||
			count( $input['selectedMappingIds'] ) > 50 ||
			! is_int( $input['expectedPendingSelectionGeneration'] ) ||
			$input['expectedPendingSelectionGeneration'] < 0 ||
			$input['expectedPendingSelectionGeneration'] > 9007199254740990 ) {
			return null;
		}
		$seen = array();
		foreach ( $input['selectedMappingIds'] as $id ) {
			if ( ! self::validId( $id ) || isset( $seen[ $id ] ) ) {
				return null;
			}
			$seen[ $id ] = true;
		}
		return $input;
	}

	private static function validId( mixed $id ): bool {
		return is_string( $id ) && strlen( $id ) <= 128 && 1 === preg_match( '/^[A-Za-z0-9_-]+$/D', $id );
	}
}
