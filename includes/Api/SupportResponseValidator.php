<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Exact, bounded API-020 DTOs. Browser input and hosted responses share these contracts. */
final class SupportResponseValidator {
	private const MESSAGE_FIELDS = array( 'id', 'kind', 'state', 'originalBody', 'displayBody', 'isTranslated', 'sourceLanguageTag', 'displayLanguageTag', 'systemCode', 'systemVersion', 'createdAt', 'readAt' );

	public static function messageId( mixed $value ): bool {
		return is_string( $value ) && 1 === preg_match( '/^[A-Za-z0-9_-]{1,191}$/D', $value );
	}

	public static function composeInput( mixed $value ): bool {
		return self::exact( $value, array( 'body', 'actionId' ) ) &&
			self::body( $value['body'] ) &&
			is_string( $value['actionId'] ) &&
			1 === preg_match( '/^[A-Za-z0-9_-]{1,128}$/D', $value['actionId'] );
	}

	public static function body( mixed $value ): bool {
		if ( ! is_string( $value ) || strlen( $value ) > 32768 ) {
			return false;
		}
		$count = preg_match_all( '/\X/u', $value );
		return false !== $count && 1 <= $count && $count <= 500;
	}

	public static function history( mixed $value, int $page, int $page_size ): bool {
		if ( ! self::exact( $value, array( 'schemaVersion', 'page', 'pageSize', 'total', 'totalPages', 'unread', 'items' ) ) ||
			1 !== $value['schemaVersion'] || $page !== $value['page'] || $page_size !== $value['pageSize'] ||
			! self::nonnegative( $value['total'] ) || ! self::nonnegative( $value['unread'] ) ||
			! is_int( $value['totalPages'] ) || $value['totalPages'] < 1 ||
			! is_array( $value['items'] ) || ! array_is_list( $value['items'] ) || count( $value['items'] ) > $page_size ) {
			return false;
		}
		foreach ( $value['items'] as $item ) {
			if ( ! self::message( $item ) ) {
				return false;
			}
		}
		return true;
	}

	public static function composeReceipt( mixed $value ): bool {
		return self::exact( $value, array( 'schemaVersion', 'messageId', 'translationId' ) ) &&
			1 === $value['schemaVersion'] && self::messageId( $value['messageId'] ) &&
			( null === $value['translationId'] || self::messageId( $value['translationId'] ) );
	}

	public static function readReceipt( mixed $value, string $message_id ): bool {
		return self::exact( $value, array( 'schemaVersion', 'messageId', 'readAt' ) ) &&
			1 === $value['schemaVersion'] && $message_id === $value['messageId'] && self::date( $value['readAt'] );
	}

	private static function message( mixed $value ): bool {
		return self::exact( $value, self::MESSAGE_FIELDS ) && self::messageId( $value['id'] ) &&
			in_array( $value['kind'], array( 'MERCHANT', 'ADMINISTRATIVE', 'SYSTEM' ), true ) &&
			in_array( $value['state'], array( 'PROCESSING', 'AVAILABLE', 'FAILED' ), true ) &&
			is_string( $value['originalBody'] ) && strlen( $value['originalBody'] ) <= 32768 &&
			( null === $value['displayBody'] || ( is_string( $value['displayBody'] ) && strlen( $value['displayBody'] ) <= 32768 ) ) &&
			is_bool( $value['isTranslated'] ) && self::bounded( $value['sourceLanguageTag'], 64 ) &&
			( null === $value['displayLanguageTag'] || self::bounded( $value['displayLanguageTag'], 64 ) ) &&
			( null === $value['systemCode'] || self::bounded( $value['systemCode'], 128 ) ) &&
			( null === $value['systemVersion'] || self::bounded( $value['systemVersion'], 64 ) ) &&
			self::date( $value['createdAt'] ) && ( null === $value['readAt'] || self::date( $value['readAt'] ) );
	}

	private static function exact( mixed $value, array $fields ): bool {
		if ( ! is_array( $value ) ) return false;
		$actual = array_keys( $value );
		sort( $actual );
		sort( $fields );
		return $actual === $fields;
	}

	private static function nonnegative( mixed $value ): bool {
		return is_int( $value ) && $value >= 0;
	}

	private static function bounded( mixed $value, int $limit ): bool {
		return is_string( $value ) && strlen( $value ) <= $limit;
	}

	private static function date( mixed $value ): bool {
		if ( ! is_string( $value ) || strlen( $value ) > 40 ||
			! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/D', $value ) ) return false;
		$parsed = date_parse( $value );
		return 0 === $parsed['error_count'] && 0 === $parsed['warning_count'];
	}
}
