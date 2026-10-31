<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClientException;

/**
 * Consent-specific operational diagnostics, never storefront notices.
 * WooCommerce owns the PHP log sink; the Node-only Shared logger is not
 * available inside a merchant-controlled WordPress installation.
 * Provider/transport diagnostics preserve the original cause when safe, after
 * bounded redaction of URLs, credentials, contacts and control characters.
 */
final class CheckoutConsentDiagnostics {
	public static function warn( string $event, ?\Throwable $error = null ): void {
		if ( ! preg_match( '/^[a-z_]{1,64}$/D', $event ) ) $event = 'unclassified_failure';
		$status = $error instanceof ModaApiClientException && is_int( $error->http_status ) &&
			$error->http_status >= 100 && $error->http_status <= 599 ? $error->http_status : 0;
		$context = array(
			'source' => 'moda-interact-consent',
			'event' => $event,
			'http_status' => $status,
		);
		if ( $error instanceof ModaApiClientException ) {
			// Preserve the actual client reason and, when present, the provider's
			// allowlisted error code (not a guessed substitute or raw response).
			$reason = $error->getMessage();
			if ( preg_match( '/^[a-z_]{1,64}$/D', $reason ) ) $context['client_reason'] = $reason;
			if ( null !== $error->remote_error ) $context['remote_error'] = $error->remote_error;
			$transport_code = self::safeTransportCode( $error->transport_error_code );
			if ( null !== $transport_code ) $context['transport_error_code'] = $transport_code;
			$transport_message = self::safeTransportMessage( $error->transport_error_message );
			if ( null !== $transport_message ) $context['transport_error_message'] = $transport_message;
		}
		try {
			if ( function_exists( 'wc_get_logger' ) ) {
				wc_get_logger()->warning( 'Moda consent operation failed', $context );
				return;
			}
		} catch ( \Throwable $sink_error ) {
			// The diagnostic sink must not become a checkout dependency.
			$event = 'woocommerce_logger_failed';
		}
		// The fallback is code-only and has no user-controlled content.
		error_log( 'moda.woocommerce.checkout_consent.' . $event . '.http_' . $status );
	}

	private static function safeTransportCode( ?string $code ): ?string {
		return is_string( $code ) && preg_match( '/^[a-zA-Z0-9_.-]{1,64}$/D', $code ) ? $code : null;
	}

	/** Redact before truncation, or a truncated URL/token might remain exposed. */
	private static function safeTransportMessage( ?string $message ): ?string {
		if ( ! is_string( $message ) || '' === trim( $message ) || strlen( $message ) > 8192 ) return null;
		$clean = preg_replace( array(
			'~\b(?:https?|ftp)://[^\s<>"\']+~i',
			'/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i',
			'/\bBearer\s+[^\s,;]+/i',
			'/\b(authorization|token|password|secret|credential|api[_-]?key)\s*[:=]\s*[^\s,;]+/i',
			'/\b[+]?[0-9]{8,15}\b/',
			'/[\x00-\x1f\x7f]/',
		), array( '[url]', '[email]', 'Bearer [redacted]', '$1=[redacted]',
			'[number]', ' ' ), $message );
		if ( ! is_string( $clean ) || '' === trim( $clean ) ) return null;
		return substr( $clean, 0, 300 );
	}
}
