<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/** Session-bound, one-time action for a verified outreach coupon conflict. */
final class CheckoutOutreachCouponChoice {
	public const SESSION_FIELD = 'moda_interact_outreach_coupon_choice_v1';
	public const ACTION_FIELD = 'moda_interact_outreach_coupon_choice';
	private const NONCE_ACTION = 'moda_interact_outreach_coupon_choice_v1';
	private const TTL_SECONDS = 600;

	public function register(): void {
		add_action( 'template_redirect', array( $this, 'dispatch' ), 1, 0 );
		add_action( 'woocommerce_checkout_order_processed', array( $this, 'invalidate' ), 1, 0 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( $this, 'invalidate' ), 1, 0 );
	}

	/** Create a choice only after a successful, explicit recovery confirmation. */
	public function record( mixed $result, string $recovery_id, string $checkout_key ): void {
		$this->invalidate();
		if ( ! is_array( $result ) || 'CONFLICT_REQUIRES_CHOICE' !== ( $result['outcome'] ?? null ) ||
			true !== ( $result['choiceAvailable'] ?? null ) || true !== ( $result['totalsRecalculated'] ?? null ) ) return;
		$codes = $result['recommendedCodes'] ?? null;
		$originals = $result['originalAppliedCodes'] ?? null;
		$current = $result['currentAppliedCodes'] ?? null;
		if ( ! self::validCodes( $codes, 1, 3 ) || ! self::validCodes( $originals, 0, 10 ) ||
			! self::validCodes( $current, 0, 10 ) || ! self::containsAll( $current, $originals ) ||
			! self::validRecoveryId( $recovery_id ) || ! CheckoutKey::valid( $checkout_key ) ) {
			$this->log( 'choice_state_record_rejected', new \RuntimeException( 'invalid_choice_result' ) );
			return;
		}
		$session = self::session();
		$cart = self::cart();
		$completed = $session && method_exists( $session, 'get' ) ? $session->get( 'moda_interact_restore_completed_v1' ) : null;
		if ( ! $session || ! method_exists( $session, 'set' ) || ! is_array( $completed ) ||
			$recovery_id !== ( $completed['recoveryId'] ?? null ) || $checkout_key !== CheckoutKey::existing() ||
			! $cart || ! method_exists( $cart, 'get_cart_hash' ) || ! method_exists( $cart, 'get_applied_coupons' ) ) {
			$this->log( 'choice_state_record_rejected', new \RuntimeException( 'checkout_session_binding_invalid' ) );
			return;
		}
		$actual = $cart->get_applied_coupons();
		if ( null === self::cartCodes( $actual ) || ! self::sameCodes( $actual, $originals ) ) {
			$this->log( 'choice_state_record_rejected', new \RuntimeException( 'original_coupon_state_changed' ) );
			return;
		}
		try {
			// WordPress nonces are reusable within their validity window. Bind this
			// nonce to an unpredictable, per-choice value kept only in the session.
			$nonce_binding = bin2hex( random_bytes( 16 ) );
			$nonce = wp_create_nonce( self::nonceAction( $nonce_binding ) );
			if ( ! is_string( $nonce ) || '' === $nonce ) return;
			$session->set( self::SESSION_FIELD, array(
				'recoveryId' => $recovery_id,
				'codes' => array_values( $codes ),
				'originalCodes' => array_values( $originals ),
				'cartHash' => (string) $cart->get_cart_hash(),
				'checkoutKey' => $checkout_key,
				'createdAt' => time(),
				'nonceBinding' => $nonce_binding,
				'nonce' => $nonce,
			) );
			if ( method_exists( $session, 'save_data' ) ) $session->save_data();
		} catch ( \Throwable $error ) {
			$this->invalidate();
			CheckoutDiagnosticLogger::record( 'checkout_coupon_choice', 'choice_state_write_failed', self::safeError( $error, $codes, $originals ) );
		}
	}

	/** Return only the nonce and booleans safe for checkout rendering. */
	public function publicState(): ?array {
		try {
			$session = self::session();
			$recorded = $session && method_exists( $session, 'get' ) ? $session->get( self::SESSION_FIELD ) : null;
			$state = $this->validCurrentState();
			if ( null === $state && is_array( $recorded ) ) $this->log( 'choice_state_stale_at_render' );
			return null === $state ? null : array( 'available' => true, 'nonce' => $state['nonce'] );
		} catch ( \Throwable $error ) {
			$this->invalidate();
			$this->log( 'choice_state_render_failed', self::safeError( $error ) );
			return null;
		}
	}

	public function invalidate(): void {
		try {
			$session = self::session();
			if ( $session && method_exists( $session, 'set' ) ) {
				$session->set( self::SESSION_FIELD, null );
			}
		} catch ( \Throwable $error ) {
			CheckoutDiagnosticLogger::record( 'checkout_coupon_choice', 'choice_state_clear_failed', self::safeError( $error ) );
		}
	}

	public function dispatch(): void {
		$method = strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) );
		if ( 'POST' !== $method || ! array_key_exists( self::ACTION_FIELD, $_POST ) ) return;
		$response = $this->handleRequest( $method, $_POST, $_SERVER );
		if ( null === $response ) return;
		wp_safe_redirect( $response['redirect'], 303 );
		exit;
	}

	/** Small dispatcher for POST and security tests; never accepts query values. */
	public function handleRequest( string $method, array $post, array $server ): ?array {
		try {
			return $this->processRequest( $method, $post, $server );
		} catch ( \Throwable $error ) {
			$this->invalidate();
			$this->log( 'choice_request_boundary_failed', self::safeError( $error ) );
			return array( 'redirect' => self::safeRedirect() );
		}
	}

	private function processRequest( string $method, array $post, array $server ): ?array {
		if ( 'POST' !== strtoupper( $method ) || ! array_key_exists( self::ACTION_FIELD, $post ) ) return null;
		$redirect = self::safeRedirect();
		$keys = array_keys( $post );
		sort( $keys );
		$length = $server['CONTENT_LENGTH'] ?? '0';
		$request_path = (string) ( parse_url( (string) ( $server['REQUEST_URI'] ?? '' ), PHP_URL_PATH ) ?? '' );
		$checkout_path = (string) ( parse_url( $redirect, PHP_URL_PATH ) ?? '' );
		if ( array( '_wpnonce', self::ACTION_FIELD ) !== $keys || 'try_offered' !== $post[ self::ACTION_FIELD ] ||
			! is_string( $post['_wpnonce'] ) || ! is_string( $length ) || ! ctype_digit( $length ) || (int) $length > 1024 ||
			! self::sameOrigin( $server ) || '' === $request_path || rtrim( $request_path, '/' ) !== rtrim( $checkout_path, '/' ) ) {
			$this->invalidate();
			$this->log( 'choice_request_rejected' );
			return array( 'redirect' => $redirect );
		}
		$state = $this->validCurrentState();
		if ( null === $state ) {
			$this->invalidate();
			$this->log( 'choice_state_stale' );
			return array( 'redirect' => $redirect );
		}
		if ( $state['nonce'] !== $post['_wpnonce'] ||
			false === wp_verify_nonce( $post['_wpnonce'], self::nonceAction( $state['nonceBinding'] ) ) ) {
			$this->log( 'choice_request_nonce_invalid' );
			return array( 'redirect' => $redirect );
		}
		// Consume before mutation, so concurrent or repeated submissions are no-ops.
		$this->invalidate();
		$cart = self::cart();
		if ( ! $cart || ! method_exists( $cart, 'remove_coupon' ) || ! method_exists( $cart, 'apply_coupon' ) ||
			! method_exists( $cart, 'get_applied_coupons' ) || ! method_exists( $cart, 'calculate_totals' ) ) {
			$this->log( 'choice_cart_unavailable' );
			return array( 'redirect' => $redirect );
		}
		$notices = function_exists( 'wc_get_notices' ) ? wc_get_notices() : null;
		try {
			if ( ! self::sameCodes( $cart->get_applied_coupons(), $state['originalCodes'] ) ||
				! hash_equals( $state['cartHash'], (string) $cart->get_cart_hash() ) ) {
				$this->log( 'choice_cart_changed' );
				return array( 'redirect' => $redirect );
			}
			foreach ( $state['originalCodes'] as $code ) $cart->remove_coupon( $code );
			foreach ( $state['codes'] as $code ) self::attempt( $cart, $code );
			if ( ! self::sameCodes( $cart->get_applied_coupons(), $state['codes'] ) ) {
				$this->restoreOriginals( $cart, $state['originalCodes'] );
				$this->log( 'choice_offer_rejected' );
				return array( 'redirect' => $redirect );
			}
			$cart->calculate_totals();
			$this->log( 'choice_offer_applied' );
			return array( 'redirect' => $redirect );
		} catch ( \Throwable $error ) {
			try {
				$this->restoreOriginals( $cart, $state['originalCodes'] );
			} catch ( \Throwable $rollback_error ) {
				$this->log( 'choice_rollback_failed', self::safeError( $rollback_error, $state['codes'], $state['originalCodes'] ) );
			}
			$this->log( 'choice_apply_failed', self::safeError( $error, $state['codes'], $state['originalCodes'] ) );
			return array( 'redirect' => $redirect );
		} finally {
			if ( is_array( $notices ) && function_exists( 'wc_set_notices' ) ) wc_set_notices( $notices );
		}
	}

	private function validCurrentState(): ?array {
		$session = self::session();
		$cart = self::cart();
		$state = $session && method_exists( $session, 'get' ) ? $session->get( self::SESSION_FIELD ) : null;
		$completed = $session && method_exists( $session, 'get' ) ? $session->get( 'moda_interact_restore_completed_v1' ) : null;
		if ( ! is_array( $state ) || ! self::validRecoveryId( $state['recoveryId'] ?? null ) ||
			! self::validCodes( $state['codes'] ?? null, 1, 3 ) || ! self::validCodes( $state['originalCodes'] ?? null, 0, 10 ) ||
			! is_string( $state['cartHash'] ?? null ) || '' === $state['cartHash'] ||
			! CheckoutKey::valid( $state['checkoutKey'] ?? null ) || ! is_int( $state['createdAt'] ?? null ) ||
			$state['createdAt'] > time() || time() - $state['createdAt'] > self::TTL_SECONDS ||
			! is_string( $state['nonceBinding'] ?? null ) || 1 !== preg_match( '/^[a-f0-9]{32}$/D', $state['nonceBinding'] ) ||
			! is_string( $state['nonce'] ?? null ) || '' === $state['nonce'] ||
			! is_array( $completed ) || $state['recoveryId'] !== ( $completed['recoveryId'] ?? null ) ||
			$state['checkoutKey'] !== CheckoutKey::existing() || ! $cart || ! method_exists( $cart, 'get_cart_hash' ) ||
			! hash_equals( $state['cartHash'], (string) $cart->get_cart_hash() ) ||
			! method_exists( $cart, 'get_applied_coupons' ) || ! self::sameCodes( $cart->get_applied_coupons(), $state['originalCodes'] ) ) {
			if ( is_array( $state ) ) $this->invalidate();
			return null;
		}
		return $state;
	}

	private function restoreOriginals( object $cart, array $codes ): void {
		$current = self::cartCodes( $cart->get_applied_coupons() );
		if ( null === $current ) throw new \RuntimeException( 'choice_coupon_state_unavailable' );
		foreach ( $current as $code ) if ( is_string( $code ) && ! self::contains( $codes, $code ) ) $cart->remove_coupon( $code );
		foreach ( $codes as $code ) {
			if ( ! self::contains( $cart->get_applied_coupons(), $code ) ) self::attempt( $cart, $code );
		}
		if ( ! self::sameCodes( $cart->get_applied_coupons(), $codes ) ) throw new \RuntimeException( 'choice_original_rollback_rejected' );
		$cart->calculate_totals();
	}

	private static function attempt( object $cart, string $code ): void {
		$notices = function_exists( 'wc_get_notices' ) ? wc_get_notices() : null;
		$suppress = static fn( mixed $message ): string => '';
		$filter = function_exists( 'add_filter' ) && function_exists( 'remove_filter' );
		if ( $filter ) add_filter( 'woocommerce_coupon_error', $suppress, PHP_INT_MAX, 3 );
		try { $cart->apply_coupon( $code ); }
		finally {
			if ( $filter ) remove_filter( 'woocommerce_coupon_error', $suppress, PHP_INT_MAX );
			if ( is_array( $notices ) && function_exists( 'wc_set_notices' ) ) wc_set_notices( $notices );
		}
	}

	private static function sameOrigin( array $server ): bool {
		$origin = $server['HTTP_ORIGIN'] ?? '';
		if ( ! is_string( $origin ) || '' === $origin ) return false;
		$expected = parse_url( home_url( '/' ) );
		$actual = parse_url( $origin );
		return is_array( $expected ) && is_array( $actual ) &&
			strtolower( (string) ( $expected['scheme'] ?? '' ) ) === strtolower( (string) ( $actual['scheme'] ?? '' ) ) &&
			strtolower( (string) ( $expected['host'] ?? '' ) ) === strtolower( (string) ( $actual['host'] ?? '' ) ) &&
			( $expected['port'] ?? null ) === ( $actual['port'] ?? null ) &&
			! isset( $actual['user'] ) && ! isset( $actual['pass'] ) && ! isset( $actual['path'] ) &&
			! isset( $actual['query'] ) && ! isset( $actual['fragment'] );
	}

	private static function sameCodes( mixed $actual, array $expected ): bool {
		$actual = self::cartCodes( $actual );
		if ( null === $actual ) return false;
		$left = array_map( self::normalize( ... ), $actual );
		$right = array_map( self::normalize( ... ), $expected );
		sort( $left ); sort( $right );
		return $left === $right;
	}

	private static function cartCodes( mixed $codes ): ?array {
		if ( ! is_array( $codes ) ) return null;
		$values = array_values( $codes );
		foreach ( $values as $code ) if ( ! is_string( $code ) || '' === $code ) return null;
		return $values;
	}

	private static function containsAll( array $actual, array $expected ): bool {
		foreach ( $expected as $code ) if ( ! self::contains( $actual, $code ) ) return false;
		return true;
	}

	private static function contains( array $codes, string $needle ): bool {
		return in_array( self::normalize( $needle ), array_map( self::normalize( ... ), $codes ), true );
	}

	private static function normalize( string $code ): string {
		return function_exists( 'wc_format_coupon_code' ) ? wc_format_coupon_code( $code ) : strtolower( trim( $code ) );
	}

	private static function validCodes( mixed $codes, int $minimum, int $maximum ): bool {
		if ( ! is_array( $codes ) || ! array_is_list( $codes ) || count( $codes ) < $minimum || count( $codes ) > $maximum ) return false;
		foreach ( $codes as $code ) if ( ! is_string( $code ) || '' === $code || strlen( $code ) > 128 ) return false;
		return true;
	}

	private static function validRecoveryId( mixed $id ): bool {
		return is_string( $id ) && 1 === preg_match( '/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/D', $id );
	}

	private static function session(): mixed {
		$commerce = function_exists( 'WC' ) ? WC() : null;
		return is_object( $commerce ) ? ( $commerce->session ?? null ) : null;
	}

	private static function cart(): mixed {
		$commerce = function_exists( 'WC' ) ? WC() : null;
		return is_object( $commerce ) ? ( $commerce->cart ?? null ) : null;
	}

	private static function nonceAction( string $binding ): string {
		return self::NONCE_ACTION . ':' . $binding;
	}

	private static function safeRedirect(): string {
		try {
			$url = function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : home_url( '/' );
			return is_string( $url ) && '' !== $url ? $url : '/';
		} catch ( \Throwable $error ) {
			return '/';
		}
	}

	private function log( string $reason, ?\Throwable $error = null ): void {
		CheckoutDiagnosticLogger::record( 'checkout_coupon_choice', $reason, $error );
	}

	private static function safeError( \Throwable $error, array ...$coupon_sets ): \Throwable {
		$message = $error->getMessage();
		foreach ( $coupon_sets as $codes ) {
			foreach ( $codes as $code ) {
				if ( is_string( $code ) && '' !== $code ) $message = str_ireplace( $code, '[redacted-coupon]', $message );
			}
		}
		return new \RuntimeException( CheckoutDiagnosticLogger::redact( $message ) );
	}
}
