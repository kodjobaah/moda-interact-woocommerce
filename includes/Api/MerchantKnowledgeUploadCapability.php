<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Strictly bounds the opaque bearer capability returned by API-018 before browser handoff. */
final class MerchantKnowledgeUploadCapability {
	public static function valid( mixed $intent, array $request, array $connection ): bool {
		if ( ! MerchantKnowledgeContracts::intentResponse( $intent, $request ) ||
			! isset( $connection['shopId'] ) || ! MerchantKnowledgeContracts::id( $connection['shopId'] ) ||
			$request['sizeBytes'] > $intent['maxUploadBytes'] || $intent['maxUploadBytes'] < 1 ) return false;

		// WordPress holds only approved non-secret origin/bucket names. Credentials live in
		// the hosted API's sealed merchant.knowledge.r2 database configuration.
		$approved_origin = defined( 'MODA_MERCHANT_KNOWLEDGE_R2_ENDPOINT' )
			? constant( 'MODA_MERCHANT_KNOWLEDGE_R2_ENDPOINT' ) : getenv( 'MODA_MERCHANT_KNOWLEDGE_R2_ENDPOINT' );
		$approved_bucket = defined( 'MODA_MERCHANT_KNOWLEDGE_R2_BUCKET' )
			? constant( 'MODA_MERCHANT_KNOWLEDGE_R2_BUCKET' ) : getenv( 'MODA_MERCHANT_KNOWLEDGE_R2_BUCKET' );
		if ( ! is_string( $approved_origin ) ||
			! preg_match( '#^https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com/?$#iD', $approved_origin ) ||
			! is_string( $approved_bucket ) ||
			! preg_match( '/^[A-Za-z0-9._-]{3,63}$/D', $approved_bucket ) ) return false;

		$url = parse_url( $intent['uploadUrl'] );
		if ( ! is_array( $url ) || ( $url['scheme'] ?? '' ) !== 'https' ||
			isset( $url['user'] ) || isset( $url['pass'] ) || isset( $url['port'] ) || isset( $url['fragment'] ) ||
			! isset( $url['host'], $url['path'], $url['query'] ) ||
			strtolower( $url['host'] ) !== strtolower( preg_replace( '#^https://|/$#i', '', $approved_origin ) ) ||
			strlen( $url['query'] ) < 30 || strlen( $url['query'] ) > 3000 ||
			preg_match( '/[\x00-\x20\x7f]/', $intent['uploadUrl'] ) ) return false;

		$shop = preg_quote( $connection['shopId'], '#' );
		$asset = preg_quote( $intent['assetId'], '#' );
		$bucket = preg_quote( $approved_bucket, '#' );
		$extension = strtolower( $request['dataFormatKey'] );
		if ( ! preg_match( '#^/' . $bucket . '/merchant-knowledge/[a-z0-9][a-z0-9-]{0,31}/woocommerce/' .
			$shop . '/' . $asset . '/source\.' . $extension . '$#D', $url['path'] ) ) return false;

		// SigV4 has a bounded clock and request lifetime. Reject duplicate/query
		// ambiguity, incomplete signatures and unexpected signed request headers.
		$params = array();
		foreach ( explode( '&', $url['query'] ) as $pair ) {
			if ( ! str_contains( $pair, '=' ) ) return false;
			list( $raw_name, $raw_value ) = explode( '=', $pair, 2 );
			$name = rawurldecode( $raw_name );
			$value = rawurldecode( $raw_value );
			if ( '' === $name || isset( $params[ $name ] ) || preg_match( '/[\x00-\x1f\x7f]/', $name . $value ) ||
				! in_array( $name, array( 'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date',
					'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature', 'X-Amz-Security-Token',
					'X-Amz-Content-Sha256', 'x-amz-content-sha256', 'x-id' ), true ) ) return false;
			if ( in_array( $name, array( 'X-Amz-Content-Sha256', 'x-amz-content-sha256' ), true ) &&
				'UNSIGNED-PAYLOAD' !== $value ) return false;
			$params[ $name ] = $value;
		}
		if ( ( $params['X-Amz-Algorithm'] ?? '' ) !== 'AWS4-HMAC-SHA256' ||
			! isset( $params['X-Amz-Credential'] ) || '' === $params['X-Amz-Credential'] ||
			! isset( $params['X-Amz-Signature'] ) || ! preg_match( '/^[a-f0-9]{64}$/iD', $params['X-Amz-Signature'] ) ||
			! isset( $params['X-Amz-Date'] ) || ! preg_match( '/^[0-9]{8}T[0-9]{6}Z$/D', $params['X-Amz-Date'] ) ||
			! isset( $params['X-Amz-Expires'] ) || ! preg_match( '/^[1-9][0-9]{0,2}$/D', $params['X-Amz-Expires'] ) ||
			(int) $params['X-Amz-Expires'] > 600 ) return false;
		$headers = explode( ';', $params['X-Amz-SignedHeaders'] ?? '' );
		sort( $headers );
		if ( $headers !== array( 'content-type', 'host', 'if-none-match', 'x-amz-meta-sha256' ) ) return false;

		$date = \DateTimeImmutable::createFromFormat( '!Ymd\THis\Z', $params['X-Amz-Date'], new \DateTimeZone( 'UTC' ) );
		if ( false === $date || $date->format( 'Ymd\THis\Z' ) !== $params['X-Amz-Date'] ) return false;
		$expires_at = strtotime( $intent['expiresAt'] );
		return $date->getTimestamp() <= time() + 60 &&
			$date->getTimestamp() + (int) $params['X-Amz-Expires'] > time() &&
			$date->getTimestamp() + (int) $params['X-Amz-Expires'] <= $expires_at + 2;
	}
}
