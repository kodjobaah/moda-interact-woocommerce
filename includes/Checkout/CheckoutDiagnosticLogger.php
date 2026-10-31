<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Shared WooCommerce logger for bounded checkout diagnostics. */
final class CheckoutDiagnosticLogger {
	private const MAX_MESSAGE_BYTES = 384;

	public static function record( string $component, string $reason, ?\Throwable $error = null ): void {
		$context = array(
			'source' => 'moda-interact',
			'component' => $component,
			'reason' => $reason,
		);
		$message = 'Checkout ' . $component . ': ' . $reason;
		if ( null !== $error ) {
			$context['error_type'] = self::safeType( $error );
			$context['error_message'] = self::redact( $error->getMessage() );
			if ( $error instanceof \ModaInteract\WooCommerce\Api\ModaApiClientException ) {
				if ( null !== $error->http_status ) $context['http_status'] = $error->http_status;
				if ( is_string( $error->remote_error ) && preg_match( '/^[a-z0-9_]{1,64}$/D', $error->remote_error ) ) {
					$context['remote_error_code'] = $error->remote_error;
				}
			}
			$message .= ' cause=' . $context['error_message'];
		}
		try {
			if ( function_exists( 'wc_get_logger' ) ) {
				wc_get_logger()->error( $message, $context );
				return;
			}
		} catch ( \Throwable $logger_error ) {
			// Diagnostic logging must not break checkout or Action Scheduler.
		}
		error_log( 'moda.woocommerce.checkout.' . $component . '.' . $reason .
			( isset( $context['error_message'] ) ? ' cause=' . $context['error_message'] : '' ) );
	}

	/** Preserve useful exception text while removing common secrets and shopper data. */
	public static function redact( string $message ): string {
		$message = preg_replace( '/[\x00-\x1F\x7F]+/', ' ', $message ) ?? '';
		$message = preg_replace( '/\bBearer\s+[^\s,;]+/i', 'Bearer [redacted]', $message ) ?? $message;
		$message = preg_replace( '/\bhttps?:\/\/[^\s"\'<>]+/i', '[redacted-url]', $message ) ?? $message;
		$message = preg_replace_callback(
			'/(\b(?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|credential|email|phone|checkout[_-]?(?:key|url)?|cart|coupon(?:[_-]?code)?|payload|request|response|body)\b\s*["\']?\s*[:=]\s*)("[^"]*"|\'[^\']*\'|[^,;\s}]+)/i',
			static fn( array $match ): string => $match[1] . '[redacted]',
			$message
		) ?? $message;
		$message = preg_replace_callback(
			'/(\bcoupon(?:\s+code)?\s+)(?:"([^"]+)"|\'([^\']+)\'|([A-Z0-9][A-Z0-9_-]{2,}))/i',
			static fn( array $match ): string => $match[1] . '[redacted-coupon]',
			$message
		) ?? $message;
		$message = preg_replace_callback(
			'/(?<![A-Z0-9])\+?\d[0-9(). -]{3,}\d(?![A-Z0-9])/i',
			static function ( array $match ): string {
				$digits = preg_replace( '/\D/', '', $match[0] ) ?? '';
				return strlen( $digits ) >= 7 && strlen( $digits ) <= 15 ? '[redacted-phone]' : $match[0];
			},
			$message
		) ?? $message;
		$message = preg_replace( '/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i', '[redacted-email]', $message ) ?? $message;
		$message = trim( $message );
		if ( strlen( $message ) > self::MAX_MESSAGE_BYTES ) {
			$message = substr( $message, 0, self::MAX_MESSAGE_BYTES - 3 ) . '...';
		}
		return $message;
	}

	private static function safeType( \Throwable $error ): string {
		$type = get_class( $error );
		return preg_match( '/^[A-Za-z_\\\\][A-Za-z0-9_\\\\]{0,127}$/D', $type ) ? $type : 'Throwable';
	}
}
