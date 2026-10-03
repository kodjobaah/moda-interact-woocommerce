<?php

namespace ModaInteract\WooCommerce\Connection;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Security\Base64Url;

final class InstallationStore {
	public const OPTION_NAME = 'moda_interact_woocommerce_connection';
	private const FIELDS = array( 'schemaVersion', 'installationId', 'shopId', 'canonicalSiteUrl', 'credential', 'credentialVersion', 'connectedAt' );

	public function read(): array {
		$value = get_option( self::OPTION_NAME, null );
		if ( null === $value ) {
			return array( 'state' => 'missing', 'record' => null );
		}
		if ( ! self::isValidRecord( $value ) ) {
			return array( 'state' => 'invalid', 'record' => null );
		}
		return array( 'state' => 'valid', 'record' => $value );
	}

	public function save( array $record ): bool {
		if ( ! self::isValidRecord( $record ) ) {
			return false;
		}
		try {
			$existing = get_option( self::OPTION_NAME, null );
			if ( null === $existing ) {
				return add_option( self::OPTION_NAME, $record, '', false );
			}
			$updated = update_option( self::OPTION_NAME, $record, false );
			if ( $updated ) {
				return true;
			}
			return self::isValidRecord( get_option( self::OPTION_NAME, null ) ) && get_option( self::OPTION_NAME, null ) === $record;
		} catch ( \Throwable $error ) {
			return false;
		}
	}

	public static function isValidRecord( mixed $record ): bool {
		if ( ! is_array( $record ) ) {
			return false;
		}
		$keys = array_keys( $record );
		sort( $keys );
		$fields = self::FIELDS;
		sort( $fields );
		return $keys === $fields &&
			1 === $record['schemaVersion'] &&
			is_string( $record['installationId'] ) && '' !== $record['installationId'] &&
			is_string( $record['shopId'] ) && '' !== $record['shopId'] &&
			is_string( $record['canonicalSiteUrl'] ) && strlen( $record['canonicalSiteUrl'] ) <= 512 &&
			is_string( $record['credential'] ) && null !== Base64Url::decode( $record['credential'], 32 ) &&
			is_int( $record['credentialVersion'] ) && $record['credentialVersion'] >= 1 &&
			is_string( $record['connectedAt'] ) && '' !== $record['connectedAt'];
	}
}