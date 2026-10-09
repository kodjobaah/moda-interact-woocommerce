<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Runtime boundary for the versioned API-005 and API-006 response contracts. */
final class StoreCategoryContracts {
	public static function isRead( mixed $payload ): bool {
		if ( ! self::keys( $payload, array( 'schemaVersion', 'requestedLocale', 'resolvedLocale', 'categories', 'storeProfile' ) ) ||
			1 !== $payload['schemaVersion'] ||
			! self::nullableText( $payload['requestedLocale'], 64 ) ||
			! self::text( $payload['resolvedLocale'], 16 ) ||
			! is_array( $payload['categories'] ) || ! array_is_list( $payload['categories'] ) || count( $payload['categories'] ) > 100 ||
			! self::profile( $payload['storeProfile'] ) ) {
			return false;
		}
		foreach ( $payload['categories'] as $category ) {
			if ( ! self::keys( $category, array( 'id', 'slug', 'localizedDisplayName', 'localizedDescription', 'mappings', 'defaultTemplate' ) ) ||
				! self::text( $category['id'], 128 ) || ! self::text( $category['slug'], 128 ) ||
				! self::text( $category['localizedDisplayName'], 255 ) || ! self::text( $category['localizedDescription'], 4096, true ) ||
				! is_array( $category['mappings'] ) || ! array_is_list( $category['mappings'] ) || count( $category['mappings'] ) > 50 ||
				! self::template( $category['defaultTemplate'], false ) ) {
				return false;
			}
			foreach ( $category['mappings'] as $mapping ) {
				if ( ! self::keys( $mapping, array( 'id', 'conditionKey', 'localizedDisplayName' ) ) ||
					! self::text( $mapping['id'], 128 ) || ! self::text( $mapping['conditionKey'], 128 ) ||
					! self::text( $mapping['localizedDisplayName'], 255 ) ) {
					return false;
				}
			}
		}
		return true;
	}

	public static function isSelection( mixed $payload ): bool {
		return self::keys( $payload, array( 'schemaVersion', 'activeCategoryId', 'activePromptRevisionId', 'activeMappingIds', 'pendingSelectionGeneration' ) ) &&
			1 === $payload['schemaVersion'] && self::text( $payload['activeCategoryId'], 128 ) &&
			self::text( $payload['activePromptRevisionId'], 128 ) &&
			self::ids( $payload['activeMappingIds'], 50 ) &&
			is_int( $payload['pendingSelectionGeneration'] ) && $payload['pendingSelectionGeneration'] >= 1;
	}

	private static function profile( mixed $profile ): bool {
		return self::keys( $profile, array( 'activeCategory', 'pendingCategory', 'activeMappingIds', 'pendingMappingIds', 'pendingSelectionGeneration', 'pendingSelectedAt', 'pendingState', 'pendingTemplate' ) ) &&
			self::identity( $profile['activeCategory'] ) && self::identity( $profile['pendingCategory'] ) &&
			self::ids( $profile['activeMappingIds'], 256 ) && self::ids( $profile['pendingMappingIds'], 256 ) &&
			is_int( $profile['pendingSelectionGeneration'] ) && $profile['pendingSelectionGeneration'] >= 0 &&
			( null === $profile['pendingSelectedAt'] || ( is_string( $profile['pendingSelectedAt'] ) && strlen( $profile['pendingSelectedAt'] ) <= 64 ) ) &&
			in_array( $profile['pendingState'], array( 'NONE', 'PENDING_PUBLICATION' ), true ) &&
			( null === $profile['pendingTemplate'] || self::template( $profile['pendingTemplate'], true ) );
	}

	private static function identity( mixed $identity ): bool {
		return null === $identity || (
			self::keys( $identity, array( 'id', 'slug', 'localizedDisplayName', 'localizedDescription' ) ) &&
			self::text( $identity['id'], 128 ) && self::text( $identity['slug'], 128 ) &&
			self::text( $identity['localizedDisplayName'], 255 ) && self::text( $identity['localizedDescription'], 4096, true )
		);
	}

	private static function template( mixed $template, bool $nullable_version ): bool {
		return self::keys( $template, array( 'id', 'key', 'displayName', 'editVersion' ) ) &&
			self::text( $template['id'], 128 ) && self::text( $template['key'], 128 ) &&
			self::text( $template['displayName'], 255 ) &&
			( ( $nullable_version && null === $template['editVersion'] ) ||
			( is_int( $template['editVersion'] ) && $template['editVersion'] >= 1 ) );
	}

	private static function ids( mixed $values, int $maximum ): bool {
		if ( ! is_array( $values ) || ! array_is_list( $values ) || count( $values ) > $maximum ) {
			return false;
		}
		foreach ( $values as $id ) {
			if ( ! self::text( $id, 128 ) ) {
				return false;
			}
		}
		return count( $values ) === count( array_unique( $values ) );
	}

	private static function nullableText( mixed $value, int $length ): bool {
		return null === $value || self::text( $value, $length );
	}

	private static function text( mixed $value, int $length, bool $allow_empty = false ): bool {
		return is_string( $value ) && ( $allow_empty || '' !== $value ) && strlen( $value ) <= $length * 4;
	}

	private static function keys( mixed $value, array $expected ): bool {
		if ( ! is_array( $value ) || array_is_list( $value ) ) {
			return false;
		}
		$actual = array_keys( $value );
		sort( $actual );
		sort( $expected );
		return $actual === $expected;
	}
}
