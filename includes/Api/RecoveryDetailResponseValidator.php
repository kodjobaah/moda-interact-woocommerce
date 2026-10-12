<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Validate the exact API-013 v1 read DTOs before exposing customer data to WordPress. */
final class RecoveryDetailResponseValidator {
	private const STATUS = array( 'DETECTED', 'MESSAGE_SENT', 'ENGAGED', 'COMPLETED', 'EXPIRED', 'CANCELLED' );
	private const DIRECTION = array( 'INBOUND', 'OUTBOUND' );
	private const SENDER = array( 'CUSTOMER', 'AGENT', 'AUTOMATION', 'HUMAN' );
	private const MESSAGE_STATUS = array( 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED' );
	private const TYPE = array( 'TEXT', 'AUDIO', 'UNSUPPORTED' );
	private const TRANSCRIPTION = array( 'NOT_REQUIRED', 'PENDING', 'COMPLETED', 'REJECTED', 'FAILED' );

	private static function exact( mixed $value, array $fields ): bool {
		if ( ! is_array( $value ) || array_is_list( $value ) ) return false;
		$actual = array_keys( $value );
		sort( $actual );
		sort( $fields );
		return $actual === $fields;
	}

	private static function nullableText( mixed $value, int $limit ): bool {
		if ( null === $value ) return true;
		if ( ! is_string( $value ) || ! preg_match( '//u', $value ) ) return false;
		return function_exists( 'mb_strlen' ) ? mb_strlen( $value, 'UTF-8' ) <= $limit : preg_match_all( '/./us', $value ) <= $limit;
	}

	private static function timestamp( mixed $value ): bool {
		if ( ! is_string( $value ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $value ) ) return false;
		$date = \DateTimeImmutable::createFromFormat( '!Y-m-d\TH:i:s.v\Z', $value, new \DateTimeZone( 'UTC' ) );
		return false !== $date && $date->format( 'Y-m-d\TH:i:s.v\Z' ) === $value;
	}

	private static function nullableTimestamp( mixed $value ): bool {
		return null === $value || self::timestamp( $value );
	}

	private static function identity( mixed $value ): bool {
		return is_string( $value ) && preg_match( '/^[A-Za-z0-9_-]{1,191}$/D', $value );
	}

	private static function value( mixed $value ): bool {
		return self::exact( $value, array( 'amount', 'currency', 'incomplete' ) ) &&
			( null === $value['amount'] || ( is_string( $value['amount'] ) && preg_match( '/^-?\d{1,40}(?:\.\d{1,30})?$/D', $value['amount'] ) ) ) &&
			( null === $value['currency'] || ( is_string( $value['currency'] ) && preg_match( '/^[A-Z]{3}$/D', $value['currency'] ) ) ) &&
			is_bool( $value['incomplete'] ) &&
			$value['incomplete'] === ( null === $value['amount'] || null === $value['currency'] );
	}

	public static function isSummary( mixed $data ): bool {
		if ( ! self::exact( $data, array( 'schemaVersion', 'timeZone', 'id', 'status', 'value', 'customer', 'hasConversation', 'milestones' ) ) ||
			1 !== $data['schemaVersion'] || ! self::identity( $data['id'] ) ||
			! in_array( $data['status'], self::STATUS, true ) || ! self::value( $data['value'] ) ||
			! is_string( $data['timeZone'] ) || '' === $data['timeZone'] || strlen( $data['timeZone'] ) > 128 ||
			! is_bool( $data['hasConversation'] ) ) return false;
		if ( null !== $data['customer'] && ( ! self::exact( $data['customer'], array( 'firstName', 'lastName', 'email' ) ) ||
			! self::nullableText( $data['customer']['firstName'], 80 ) ||
			! self::nullableText( $data['customer']['lastName'], 80 ) ||
			! self::nullableText( $data['customer']['email'], 320 ) ) ) return false;
		$m = $data['milestones'];
		return self::exact( $m, array( 'detectedAt', 'messageSentAt', 'engagedAt', 'completedAt', 'expiredAt' ) ) &&
			self::timestamp( $m['detectedAt'] ) && self::nullableTimestamp( $m['messageSentAt'] ) &&
			self::nullableTimestamp( $m['engagedAt'] ) && self::nullableTimestamp( $m['completedAt'] ) &&
			self::nullableTimestamp( $m['expiredAt'] );
	}

	private static function message( mixed $item ): bool {
		if ( ! self::exact( $item, array( 'id', 'createdAt', 'direction', 'sender', 'content', 'delivery' ) ) ||
			! self::identity( $item['id'] ) || ! self::timestamp( $item['createdAt'] ) ||
			( null !== $item['direction'] && ! in_array( $item['direction'], self::DIRECTION, true ) ) ||
			( null !== $item['sender'] && ! in_array( $item['sender'], self::SENDER, true ) ) ||
			! self::exact( $item['content'], array( 'type', 'text', 'transcriptionStatus' ) ) ||
			! in_array( $item['content']['type'], self::TYPE, true ) ||
			! self::nullableText( $item['content']['text'], 32000 ) ||
			( null !== $item['content']['transcriptionStatus'] && ! in_array( $item['content']['transcriptionStatus'], self::TRANSCRIPTION, true ) ) ) return false;
		$d = $item['delivery'];
		return null === $d || ( self::exact( $d, array( 'status', 'sentAt', 'deliveredAt', 'readAt' ) ) &&
			( null === $d['status'] || in_array( $d['status'], self::MESSAGE_STATUS, true ) ) &&
			self::nullableTimestamp( $d['sentAt'] ) && self::nullableTimestamp( $d['deliveredAt'] ) &&
			self::nullableTimestamp( $d['readAt'] ) );
	}

	private static function related( mixed $item ): bool {
		return self::exact( $item, array( 'id', 'status', 'detectedAt', 'value' ) ) &&
			self::identity( $item['id'] ) && in_array( $item['status'], self::STATUS, true ) &&
			self::timestamp( $item['detectedAt'] ) && self::value( $item['value'] );
	}

	public static function isPage( mixed $data, string $section ): bool {
		$limit = 'messages' === $section ? 50 : ( 'related' === $section ? 5 : 0 );
		if ( 0 === $limit || ! self::exact( $data, array( 'schemaVersion', 'items', 'previousCursor', 'nextCursor' ) ) ||
			1 !== $data['schemaVersion'] || ! is_array( $data['items'] ) || ! array_is_list( $data['items'] ) || count( $data['items'] ) > $limit ) return false;
		foreach ( array( 'previousCursor', 'nextCursor' ) as $key ) {
			if ( null !== $data[ $key ] && ( ! is_string( $data[ $key ] ) || ! preg_match( '/^[A-Za-z0-9_-]{1,1024}$/D', $data[ $key ] ) ) ) return false;
		}
		foreach ( $data['items'] as $item ) {
			if ( 'messages' === $section ? ! self::message( $item ) : ! self::related( $item ) ) return false;
		}
		return true;
	}
}
