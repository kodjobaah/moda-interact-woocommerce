<?php

namespace ModaInteract\WooCommerce\Security;

defined( 'ABSPATH' ) || exit;

final class HmacProof {
	public static function create( string $secret, string $attempt_id, string $nonce, string $canonical_site_url ): string {
		$message = "moda-interact-connect-v1\n" . $attempt_id . "\n" . $nonce . "\n" . $canonical_site_url;
		return Base64Url::encode( hash_hmac( 'sha256', $message, $secret, true ) );
	}
}