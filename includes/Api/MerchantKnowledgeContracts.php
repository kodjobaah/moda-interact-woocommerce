<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Explicit, browser-safe API-014..017 contracts. Unknown fields never cross the WordPress boundary. */
final class MerchantKnowledgeContracts {
	private const ID = '/^[A-Za-z0-9_-]{1,128}$/D';
	private const HASH = '/^[a-f0-9]{64}$/D';
	private const LANG = '/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/D';
	private const PURPOSE_KEYS = array( 'COMPANY_INFORMATION', 'CUSTOMER_SUPPORT', 'POLICIES', 'FAQ', 'PRODUCT_INFORMATION', 'SHIPPING_AND_DELIVERY', 'PRICING' );
	private const SUPPORTED_LANGUAGES = array( 'zh-Hans', 'zh-Hant', 'cs', 'da', 'nl', 'en', 'fi', 'fr', 'de', 'it', 'ja', 'ko', 'nb', 'pl', 'pt-BR', 'pt-PT', 'es', 'sv', 'th', 'tr' );
	private const DATA_FORMATS = array( 'WEB_PAGE', 'CSV', 'XLSX' );
	private const FAILURE_CODES = array( 'SOURCE_TYPE_UNSUPPORTED', 'LOCATOR_FORMAT_MISMATCH', 'UNSAFE_URL', 'UNSUPPORTED_MEDIA_TYPE',
		'UPLOAD_HASH_MISMATCH', 'UPLOAD_FORMAT_INVALID', 'XLSX_ACTIVE_CONTENT', 'CONTENT_INVALID', 'DNS_TEMPORARY', 'FETCH_TIMEOUT',
		'HTTP_429', 'HTTP_5XX', 'R2_TEMPORARY', 'EMBEDDING_PROVIDER_TEMPORARY', 'DATABASE_TRANSIENT', 'RETRIES_EXHAUSTED' );

	public static function id( mixed $value ): bool { return is_string( $value ) && 1 === preg_match( self::ID, $value ); }
	private static function keys( mixed $value, array $keys, array $required = array() ): bool {
		if ( ! is_array( $value ) || array_is_list( $value ) ) return false;
		return ! array_diff( array_keys( $value ), $keys ) && ! array_diff( $required, array_keys( $value ) );
	}
	private static function exact( mixed $value, array $keys ): bool { return self::keys( $value, $keys, $keys ); }
	private static function text( mixed $value, int $max = 160 ): bool {
		return is_string( $value ) && '' !== trim( $value ) && strlen( $value ) <= $max && ! preg_match( '/[\x00-\x1f\x7f]/', $value );
	}
	private static function uint( mixed $v, int $max = 2147483647 ): bool { return is_int( $v ) && $v >= 0 && $v <= $max; }
	private static function nullable( mixed $v, callable $check ): bool { return null === $v || $check( $v ); }
	private static function language( mixed $v ): bool { return is_string( $v ) && in_array( $v, self::SUPPORTED_LANGUAGES, true ); }
	private static function purpose( mixed $v ): bool { return is_string( $v ) && in_array( $v, self::PURPOSE_KEYS, true ); }
	private static function web( mixed $v ): bool {
		if ( ! self::text( $v, 2048 ) || preg_match( '/\s/', $v ) ) return false;
		$parts = parse_url( $v );
		return is_array( $parts ) && ( $parts['scheme'] ?? '' ) === 'https' && ! empty( $parts['host'] ) &&
			! isset( $parts['user'] ) && ! isset( $parts['pass'] ) && ! isset( $parts['port'] ) &&
			! preg_match( '/(?:^|\.)r2\.(?:cloudflarestorage\.com|dev)$/iD', $parts['host'] ) &&
			filter_var( $parts['host'], FILTER_VALIDATE_IP ) === false &&
			preg_match( '/^[a-z0-9.-]+$/iD', $parts['host'] ) === 1;
	}

	public static function request( string $operation, mixed $body ): bool {
		switch ( $operation ) {
			case 'features_update':
				if ( ! self::exact( $body, array( 'expectedRevision', 'changes' ) ) ||
					! is_string( $body['expectedRevision'] ) || ! preg_match( self::HASH, $body['expectedRevision'] ) ||
					! is_array( $body['changes'] ) || count( $body['changes'] ) > 1000 ) return false;
				$ids = array();
				foreach ( $body['changes'] as $change ) {
					if ( ! self::exact( $change, array( 'featureId', 'enabled' ) ) || ! self::id( $change['featureId'] ) ||
						! is_bool( $change['enabled'] ) || isset( $ids[ $change['featureId'] ] ) ) return false;
					$ids[ $change['featureId'] ] = true;
				}
				return true;
			case 'web_create':
				return self::keys( $body, array( 'name', 'purposeKey', 'dataFormatKey', 'url', 'languageTag' ),
					array( 'name', 'purposeKey', 'dataFormatKey', 'url' ) ) && $body['dataFormatKey'] === 'WEB_PAGE' &&
					self::text( $body['name'] ) && self::purpose( $body['purposeKey'] ) && self::web( $body['url'] ) &&
					( ! isset( $body['languageTag'] ) || self::language( $body['languageTag'] ) );
			case 'web_patch':
				return self::keys( $body, array( 'expectedGeneration', 'name', 'url', 'languageTag' ), array( 'expectedGeneration' ) ) &&
					self::uint( $body['expectedGeneration'], 2147483646 ) && $body['expectedGeneration'] > 0 &&
					count( $body ) > 1 && ( ! isset( $body['name'] ) || self::text( $body['name'] ) ) &&
					( ! isset( $body['url'] ) || self::web( $body['url'] ) ) &&
					( ! isset( $body['languageTag'] ) || self::language( $body['languageTag'] ) );
			case 'generation':
				return self::exact( $body, array( 'expectedGeneration' ) ) &&
					self::uint( $body['expectedGeneration'], 2147483646 ) && $body['expectedGeneration'] > 0;
			case 'order':
				if ( ! self::exact( $body, array( 'sourceIds' ) ) || ! is_array( $body['sourceIds'] ) || count( $body['sourceIds'] ) > 1000 ) return false;
				foreach ( $body['sourceIds'] as $id ) if ( ! self::id( $id ) ) return false;
				return count( $body['sourceIds'] ) === count( array_unique( $body['sourceIds'] ) );
			case 'upload_intent':
				if ( ! self::exact( $body, array( 'idempotencyKey', 'purposeKey', 'dataFormatKey', 'originalFileName',
					'contentType', 'sizeBytes', 'sha256' ) ) ||
					! is_string( $body['idempotencyKey'] ) ||
					! preg_match( '/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$/D', $body['idempotencyKey'] ) ||
					! self::purpose( $body['purposeKey'] ) || ! in_array( $body['dataFormatKey'], array( 'CSV', 'XLSX' ), true ) ||
					! self::text( $body['originalFileName'], 255 ) ||
					( str_contains( $body['originalFileName'], '/' ) || str_contains( $body['originalFileName'], '\\' ) ||
						! preg_match( '/\.' . strtolower( $body['dataFormatKey'] ) . '$/iD', $body['originalFileName'] ) ) ||
					! self::uploadMime( $body['contentType'], $body['dataFormatKey'] ) ||
					! self::positiveUploadSize( $body['sizeBytes'] ) || ! self::digest( $body['sha256'] ) ) return false;
				return true;
			case 'upload_finalize':
				return self::keys( $body, array( 'assetId', 'purposeKey', 'name', 'languageTag', 'contentType',
					'sizeBytes', 'sha256', 'sourceId' ), array( 'assetId', 'purposeKey', 'name', 'languageTag',
					'contentType', 'sizeBytes', 'sha256' ) ) && self::id( $body['assetId'] ) &&
					self::purpose( $body['purposeKey'] ) && self::text( $body['name'] ) &&
					self::language( $body['languageTag'] ) && self::uploadMime( $body['contentType'] ) &&
					self::positiveUploadSize( $body['sizeBytes'] ) && self::digest( $body['sha256'] ) &&
					( ! array_key_exists( 'sourceId', $body ) || self::id( $body['sourceId'] ) );
			case 'upload_edit':
				return self::exact( $body, array( 'name', 'languageTag' ) ) && self::text( $body['name'] ) && self::language( $body['languageTag'] );
		}
		return false;
	}

	private static function digest( mixed $v ): bool {
		return is_string( $v ) && 1 === preg_match( self::HASH, $v );
	}
	private static function positiveUploadSize( mixed $v ): bool {
		return is_int( $v ) && $v >= 1 && $v <= 25 * 1024 * 1024;
	}
	private static function uploadMime( mixed $v, ?string $format = null ): bool {
		if ( ! is_string( $v ) ) return false;
		$allowed = array(
			'CSV' => array( 'text/csv', 'application/csv' ),
			'XLSX' => array( 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ),
		);
		return null === $format
			? in_array( $v, array_merge( ...array_values( $allowed ) ), true )
			: in_array( $v, $allowed[ $format ] ?? array(), true );
	}

	public static function featureResponse( mixed $v ): bool {
		if ( ! self::exact( $v, array( 'schemaVersion', 'revision', 'features' ) ) || $v['schemaVersion'] !== 1 ||
			! is_string( $v['revision'] ) || ! preg_match( self::HASH, $v['revision'] ) || ! is_array( $v['features'] ) || count( $v['features'] ) > 1000 ) return false;
		$ids = array();
		foreach ( $v['features'] as $row ) {
			if ( ! self::exact( $row, array( 'id', 'key', 'name', 'description', 'enabled', 'effective', 'editable', 'required', 'planEligible' ) ) ||
				! self::id( $row['id'] ) || ! self::id( $row['key'] ) || ! self::text( $row['name'], 255 ) ||
				! self::nullable( $row['description'], static fn( $x ) => is_string( $x ) && strlen( $x ) <= 10000 ) ||
				isset( $ids[ $row['id'] ] ) ) return false;
			foreach ( array( 'enabled', 'effective', 'editable', 'required', 'planEligible' ) as $key ) if ( ! is_bool( $row[ $key ] ) ) return false;
			if ( ( $row['editable'] && ( ! $row['planEligible'] || $row['required'] ) ) || ( $row['effective'] && ! $row['planEligible'] ) ) return false;
			$ids[ $row['id'] ] = true;
		}
		return true;
	}

	/** Full projection field checks, including nested objects; rejects accidental credential/storage disclosures. */
	public static function knowledgeResponse( mixed $v ): bool {
		$keys = array( 'schemaVersion', 'state', 'planEntitled', 'merchantEnabled', 'effectiveEnabled', 'maxKnowledgeSources',
			'maxContentUnitsPerSource', 'maxUploadBytes', 'configuredCount', 'planEligibleSourceCount', 'defaultLanguageTag',
			'supportedLanguageTags', 'catalogue', 'sources', 'nextPosition' );
		if ( ! self::exact( $v, $keys ) || $v['schemaVersion'] !== 1 ||
			! in_array( $v['state'], array( 'ENABLED', 'MERCHANT_DISABLED', 'PLAN_UNENTITLED' ), true ) ) return false;
		foreach ( array( 'planEntitled', 'merchantEnabled', 'effectiveEnabled' ) as $key ) if ( ! is_bool( $v[ $key ] ) ) return false;
		foreach ( array( 'maxKnowledgeSources', 'maxContentUnitsPerSource', 'configuredCount', 'planEligibleSourceCount' ) as $key ) {
			if ( ! self::uint( $v[ $key ], 25000000 ) ) return false;
		}
		if ( ! self::uint( $v['maxUploadBytes'], 25 * 1024 * 1024 ) ) return false;
		if ( ! self::language( $v['defaultLanguageTag'] ) || ! is_array( $v['supportedLanguageTags'] ) || count( $v['supportedLanguageTags'] ) > 25 ||
			! is_array( $v['catalogue'] ) || count( $v['catalogue'] ) > 200 || ! is_array( $v['sources'] ) || count( $v['sources'] ) > 100 ||
			! self::nullable( $v['nextPosition'], static fn( $n ) => self::uint( $n ) ) ) return false;
		foreach ( $v['supportedLanguageTags'] as $tag ) if ( ! self::language( $tag ) ) return false;
		foreach ( $v['catalogue'] as $row ) {
			if ( ! self::exact( $row, array( 'purpose', 'dataFormat' ) ) || ! self::exact( $row['purpose'], array( 'key', 'displayName' ) ) ||
				! self::exact( $row['dataFormat'], array( 'key', 'displayName', 'inputKind', 'canonicalExtension', 'acceptedContentTypes' ) ) ||
				! self::purpose( $row['purpose']['key'] ) || ! self::text( $row['purpose']['displayName'] ) ||
				! in_array( $row['dataFormat']['key'], self::DATA_FORMATS, true ) || ! self::text( $row['dataFormat']['displayName'] ) ||
				! in_array( $row['dataFormat']['inputKind'], array( 'REMOTE_URL', 'UPLOAD' ), true ) ||
				! self::nullable( $row['dataFormat']['canonicalExtension'], static fn( $x ) => is_string( $x ) && (bool) preg_match( '/^\.[A-Za-z0-9]{1,15}$/D', $x ) ) ||
				! is_array( $row['dataFormat']['acceptedContentTypes'] ) || count( $row['dataFormat']['acceptedContentTypes'] ) > 20 ) return false;
			foreach ( $row['dataFormat']['acceptedContentTypes'] as $mime ) if ( ! self::text( $mime, 128 ) ) return false;
		}
		foreach ( $v['sources'] as $source ) {
			if ( ! self::exact( $source, array( 'id', 'name', 'purposeKey', 'purposeDisplayName', 'dataFormatKey', 'dataFormatDisplayName',
				'uploadedFileName', 'languageTag', 'position', 'currentGeneration', 'currentlyPlanEntitled', 'processingEligible',
				'dormantReason', 'revision', 'activeRevision' ) ) || ! self::id( $source['id'] ) || ! self::text( $source['name'] ) ||
				! self::purpose( $source['purposeKey'] ) || ! self::text( $source['purposeDisplayName'] ) ||
				! in_array( $source['dataFormatKey'], self::DATA_FORMATS, true ) || ! self::text( $source['dataFormatDisplayName'] ) ||
				! self::nullable( $source['uploadedFileName'], static fn( $s ) => self::text( $s, 255 ) ) ||
				! self::language( $source['languageTag'] ) || ! self::uint( $source['position'] ) ||
				! self::uint( $source['currentGeneration'] ) || ! is_bool( $source['currentlyPlanEntitled'] ) ||
				! is_bool( $source['processingEligible'] ) || ! in_array( $source['dormantReason'], array( null, 'NO_CURRENT_PLAN', 'SOURCE_TYPE', 'SOURCE_COUNT', 'MERCHANT_DISABLED' ), true ) ) return false;
			if ( null !== $source['revision'] ) {
				$r = $source['revision'];
				if ( ! self::exact( $r, array( 'id', 'generation', 'reason', 'status', 'requestedUrl', 'resolvedUrl', 'contentUnits', 'truncated',
					'fetchedAt', 'completedAt', 'failureCode', 'activeContentUnits', 'activeTruncated', 'activeFetchedAt' ) ) ||
					! self::id( $r['id'] ) || ! self::uint( $r['generation'] ) || ! in_array( $r['reason'], array( 'CREATE', 'URL_CHANGE', 'FILE_REPLACE', 'REFRESH', 'REPROCESS', 'ENTITLEMENT_CHANGE' ), true ) ||
					! in_array( $r['status'], array( 'PENDING', 'PROCESSING', 'ACTIVE', 'FAILED', 'SUPERSEDED' ), true ) ||
					! self::nullable( $r['requestedUrl'], static fn( $s ) => self::web( $s ) && ! str_contains( $s, '?' ) && ! str_contains( $s, '#' ) ) ||
					! self::nullable( $r['resolvedUrl'], static fn( $s ) => self::web( $s ) && ! str_contains( $s, '?' ) && ! str_contains( $s, '#' ) ) ||
					! self::nullable( $r['contentUnits'], static fn( $n ) => self::uint( $n ) ) || ! is_bool( $r['truncated'] ) ||
					! self::nullable( $r['fetchedAt'], static fn( $s ) => is_string( $s ) && strlen( $s ) <= 40 ) ||
					! self::nullable( $r['completedAt'], static fn( $s ) => is_string( $s ) && strlen( $s ) <= 40 ) ||
					! in_array( $r['failureCode'], array_merge( array( null ), self::FAILURE_CODES ), true ) ||
					! self::nullable( $r['activeContentUnits'], static fn( $n ) => self::uint( $n ) ) || ! is_bool( $r['activeTruncated'] ) ||
					! self::nullable( $r['activeFetchedAt'], static fn( $s ) => is_string( $s ) && strlen( $s ) <= 40 ) ) return false;
			}
			if ( null !== $source['activeRevision'] ) {
				$a = $source['activeRevision'];
				if ( ! self::exact( $a, array( 'id', 'generation', 'contentUnits', 'truncated', 'fetchedAt' ) ) ||
					! self::id( $a['id'] ) || ! self::uint( $a['generation'] ) ||
					! self::nullable( $a['contentUnits'], static fn( $n ) => self::uint( $n ) ) || ! is_bool( $a['truncated'] ) ||
					! self::nullable( $a['fetchedAt'], static fn( $s ) => is_string( $s ) && strlen( $s ) <= 40 ) ) return false;
			}
		}
		return true;
	}

	public static function commandResponse( mixed $v ): bool {
		return self::keys( $v, array( 'sourceId', 'created', 'knowledge' ), array( 'knowledge' ) ) &&
			( ! isset( $v['sourceId'] ) || self::id( $v['sourceId'] ) ) &&
			( ! isset( $v['created'] ) || is_bool( $v['created'] ) ) && self::knowledgeResponse( $v['knowledge'] );
	}
	/** Minimal browser-consumed envelope; Moda API owns R2 signing and header details. */
	public static function intentResponse( mixed $v, array $request ): bool {
		return self::exact( $v, array( 'schemaVersion', 'assetId', 'uploadUrl', 'expiresAt', 'maxUploadBytes', 'requiredHeaders' ) ) &&
			$v['schemaVersion'] === 1 && self::id( $v['assetId'] ) && self::text( $v['uploadUrl'], 4096 ) &&
			is_string( $v['expiresAt'] ) && strtotime( $v['expiresAt'] ) !== false &&
			self::uint( $v['maxUploadBytes'] ) && is_array( $v['requiredHeaders'] ) &&
			! array_is_list( $v['requiredHeaders'] ) && count( $v['requiredHeaders'] ) > 0 &&
			count( $v['requiredHeaders'] ) <= 16 &&
			count( array_filter( $v['requiredHeaders'], 'is_string' ) ) === count( $v['requiredHeaders'] );
	}
	public static function uploadResult( mixed $v ): bool {
		return self::exact( $v, array( 'schemaVersion', 'sourceId', 'revisionId', 'generation', 'status' ) ) &&
			$v['schemaVersion'] === 1 && self::id( $v['sourceId'] ) && self::id( $v['revisionId'] ) &&
			self::uint( $v['generation'] ) && $v['generation'] > 0 && $v['status'] === 'ACCEPTED';
	}
	public static function editResult( mixed $v ): bool {
		return self::exact( $v, array( 'schemaVersion', 'sourceId', 'updated' ) ) &&
			$v['schemaVersion'] === 1 && self::id( $v['sourceId'] ) && $v['updated'] === true;
	}
}
