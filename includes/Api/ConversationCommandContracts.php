<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Strict allowlists for the API-003/004 Woo-only conversation command surface. */
final class ConversationCommandContracts {
	private const ID = '/^[A-Za-z0-9_-]{1,191}$/D';
	private const IDEMPOTENCY_KEY = '/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/D';
	private const STATES = array( 'ACCEPTED', 'CLAIMED', 'DISPATCH_ADMITTED', 'SENT', 'FAILED', 'CANCELLED', 'UNKNOWN' );
	private const KINDS = array( 'HUMAN_TEXT', 'RECOVERY_FOLLOW_UP_TEMPLATE' );
	private const MODERATION = array( 'moderation_pending', 'moderation_allowed', 'moderation_blocked', 'moderation_review_required', 'moderation_retryable_error' );
	private const REASONS = array( 'moderation_blocked', 'moderation_review_required', 'moderation_empty_input', 'moderation_unavailable' );

	public static function identifier( mixed $id ): bool {
		return is_string( $id ) && 1 === preg_match( self::ID, $id );
	}

	private static function keys( mixed $value, array $fields ): bool {
		if ( ! is_array( $value ) || array_is_list( $value ) ) return false;
		$actual = array_keys( $value ); sort( $actual ); sort( $fields );
		return $actual === $fields;
	}

	private static function revision( mixed $value ): bool {
		return is_int( $value ) && $value >= 0 && $value <= 2147483647;
	}

	private static function clean( string $value ): bool {
		return ! preg_match( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value ) && 1 === preg_match( '//u', $value );
	}

	public static function request( mixed $payload, string $operation ): bool {
		if ( 'control' === $operation ) {
			return self::keys( $payload, array( 'targetMode', 'expectedControlRevision' ) ) &&
				in_array( $payload['targetMode'], array( 'HUMAN', 'AI' ), true ) && self::revision( $payload['expectedControlRevision'] );
		}
		if ( 'messages' !== $operation || ! is_array( $payload ) || ! isset( $payload['kind'] ) ) return false;
		if ( ! self::revision( $payload['expectedControlRevision'] ?? null ) ||
			! is_string( $payload['idempotencyKey'] ?? null ) ||
			1 !== preg_match( self::IDEMPOTENCY_KEY, $payload['idempotencyKey'] ) ) return false;
		if ( 'HUMAN_TEXT' === $payload['kind'] ) {
			$text = $payload['textBody'] ?? null;
			return self::keys( $payload, array( 'kind', 'expectedControlRevision', 'idempotencyKey', 'textBody' ) ) &&
				is_string( $text ) && '' !== $text && $text === trim( $text ) && self::clean( $text ) &&
				( function_exists( 'mb_strlen' ) ? mb_strlen( $text, 'UTF-8' ) : preg_match_all( '/./us', $text ) ) <= 4000;
		}
		if ( 'RECOVERY_FOLLOW_UP_TEMPLATE' !== $payload['kind'] ||
			! self::keys( $payload, array( 'kind', 'expectedControlRevision', 'idempotencyKey', 'templateName', 'templateLanguage', 'templateParameters' ) ) ||
			! is_string( $payload['templateName'] ) || ! preg_match( '/^[a-z][a-z0-9_]{0,254}$/D', $payload['templateName'] ) ||
			! is_string( $payload['templateLanguage'] ) || ! preg_match( '/^[a-z]{2,3}(?:_[A-Z]{2})?$/D', $payload['templateLanguage'] ) ) return false;
		$params = $payload['templateParameters'];
		return $params === array() || ( is_array( $params ) && array_is_list( $params ) && count( $params ) <= 16 &&
			! array_filter( $params, static fn( $item ) => ! is_string( $item ) || strlen( $item ) > 1024 ||
				! self::clean( $item ) || ( function_exists( 'mb_strlen' ) ? mb_strlen( $item, 'UTF-8' ) : preg_match_all( '/./us', $item ) ) > 256 ) );
	}

	public static function response( mixed $value, string $operation, string $conversation_id ): bool {
		if ( ! is_array( $value ) || ( $value['schemaVersion'] ?? null ) !== 1 ||
			( $value['conversationId'] ?? null ) !== $conversation_id ) return false;
		if ( 'control' === $operation ) return self::keys( $value, array( 'schemaVersion', 'conversationId', 'controlMode', 'controlRevision', 'controlChangedAt' ) ) &&
			in_array( $value['controlMode'], array( 'AI', 'HUMAN' ), true ) && self::revision( $value['controlRevision'] ) &&
			( null === $value['controlChangedAt'] || self::date( $value['controlChangedAt'] ) );
		if ( 'messages' === $operation && ! self::keys( $value, array( 'schemaVersion', 'commandId', 'conversationId', 'kind', 'state', 'controlRevision' ) ) ) return false;
		if ( 'status' === $operation && ! self::keys( $value, array( 'schemaVersion', 'commandId', 'conversationId', 'kind', 'state', 'createdAt', 'updatedAt', 'messageId', 'failureCode', 'moderationStatus', 'moderationReasonCode' ) ) ) return false;
		if ( ! self::identifier( $value['commandId'] ?? null ) || ! in_array( $value['kind'] ?? null, self::KINDS, true ) ||
			! in_array( $value['state'] ?? null, self::STATES, true ) ) return false;
		if ( 'messages' === $operation ) return self::revision( $value['controlRevision'] );
		return self::date( $value['createdAt'] ?? null ) && self::date( $value['updatedAt'] ?? null ) &&
			( null === $value['messageId'] || self::identifier( $value['messageId'] ) ) &&
			( null === $value['failureCode'] || ( is_string( $value['failureCode'] ) && strlen( $value['failureCode'] ) <= 128 ) ) &&
			in_array( $value['moderationStatus'], self::MODERATION, true ) &&
			in_array( $value['moderationReasonCode'], array_merge( array( null ), self::REASONS ), true );
	}

	private static function date( mixed $value ): bool {
		return is_string( $value ) && strlen( $value ) <= 40 && false !== strtotime( $value );
	}
}
