<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Connection\InstallationStore;

/**
 * Server-only pointer to an ACKNOWLEDGED Woo checkout grant. This is never a
 * substitute for API-006's current consent/STOP check and is never serialized
 * into storefront HTML, JavaScript, or a browser-visible REST response.
 */
final class CheckoutConsentProof {
	private const SESSION_KEY = 'moda_woo_checkout_grant_proof_v1';
	private const USER_META_KEY = '_moda_woo_checkout_grant_proof_v1';

	/** Retain a read capability only after a successful hosted GRANT ACK. */
	public function rememberGrant( array $event ): void {
		if ( 'GRANT' !== ( $event['decision'] ?? null ) ||
			'woo.whatsapp-consent.v2' !== ( $event['schemaVersion'] ?? null ) ||
			! CheckoutKey::valid( $event['eventId'] ?? null ) ) return;
		$scope = $this->scope();
		$phone = $event['canonicalPhone'] ?? null;
		if ( null === $scope || ! is_string( $phone ) ||
			1 !== preg_match( '/^[1-9][0-9]{1,14}$/D', $phone ) ) return;
		$proof = array(
			'eventId' => $event['eventId'],
			'shopId' => $scope['shopId'],
			'installationId' => $scope['installationId'],
			'credentialVersion' => $scope['credentialVersion'],
			'phoneDigest' => $this->digest( $scope['shopId'], $phone ),
			'userId' => $scope['userId'],
		);
		if ( null === $proof['phoneDigest'] ) return;
		if ( $scope['userId'] > 0 ) {
			// An account may retrieve its own proof on a later authenticated visit.
			if ( function_exists( 'update_user_meta' ) ) {
				update_user_meta( $scope['userId'], self::USER_META_KEY, $proof );
			}
		} else {
			// Guest proof is tied to THIS WC session and checkout/cart only.
			$proof['principal'] = $scope['principal'];
			$proof['checkoutKey'] = CheckoutKey::current();
			if ( null !== $proof['checkoutKey'] ) $scope['session']->set( self::SESSION_KEY, $proof );
		}
	}

	/** The event ID is a server-only read capability, NEVER a browser diagnostic. */
	public function forCurrentShopper( string $phone ): ?array {
		return $this->inspectForCurrentShopper( $phone )['proof'];
	}

	/** Fixed failure identifiers distinguish proof stages without disclosing proof data. */
	public function inspectForCurrentShopper( string $phone ): array {
		$scope = $this->scope();
		if ( null === $scope ) return array( 'proof' => null, 'reason' => 'consent_proof_scope_unavailable' );
		if ( 1 !== preg_match( '/^[1-9][0-9]{1,14}$/D', $phone ) ) {
			return array( 'proof' => null, 'reason' => 'consent_proof_phone_invalid' );
		}
		$proof = $scope['userId'] > 0 && function_exists( 'get_user_meta' )
			? get_user_meta( $scope['userId'], self::USER_META_KEY, true )
			: $scope['session']->get( self::SESSION_KEY );
		if ( ! is_array( $proof ) ) return array( 'proof' => null, 'reason' => 'consent_proof_missing' );
		$expected = $this->digest( $scope['shopId'], $phone );
		if ( null === $expected ) return array( 'proof' => null, 'reason' => 'consent_proof_digest_unavailable' );
		if ( ! is_string( $proof['phoneDigest'] ?? null ) ||
			! hash_equals( $expected, $proof['phoneDigest'] ) ) {
			return array( 'proof' => null, 'reason' => 'consent_proof_phone_mismatch' );
		}
		if ( ( $proof['shopId'] ?? null ) !== $scope['shopId'] ||
			( $proof['installationId'] ?? null ) !== $scope['installationId'] ||
			( $proof['credentialVersion'] ?? null ) !== $scope['credentialVersion'] ) {
			return array( 'proof' => null, 'reason' => 'consent_proof_installation_mismatch' );
		}
		if ( ( $proof['userId'] ?? null ) !== $scope['userId'] ) {
			return array( 'proof' => null, 'reason' => 'consent_proof_shopper_mismatch' );
		}
		if ( ! CheckoutKey::valid( $proof['eventId'] ?? null ) ) {
			return array( 'proof' => null, 'reason' => 'consent_proof_event_invalid' );
		}
		if ( 0 === $scope['userId'] && (
			( $proof['principal'] ?? null ) !== $scope['principal'] ||
			( $proof['checkoutKey'] ?? null ) !== CheckoutKey::existing()
		) ) return array( 'proof' => null, 'reason' => 'consent_proof_checkout_mismatch' );
		return array( 'proof' => array( 'grantEventId' => $proof['eventId'],
			'canonicalPhone' => $phone ), 'reason' => '' );
	}

	/** A new checkout, guest login/logout or phone transition invalidates local guest capability. */
	public function clearSession(): void {
		$woo = function_exists( 'WC' ) ? WC() : null;
		$session = $woo->session ?? null;
		if ( $session ) $session->set( self::SESSION_KEY, null );
	}

	/** A successfully acknowledged withdrawal or a changed account/recipient invalidates proof. */
	public function clearCurrent(): void {
		$this->clearSession();
		$user_id = function_exists( 'get_current_user_id' ) ? (int) get_current_user_id() : 0;
		if ( $user_id > 0 && function_exists( 'delete_user_meta' ) ) {
			delete_user_meta( $user_id, self::USER_META_KEY );
		}
	}

	private function scope(): ?array {
		$woo = function_exists( 'WC' ) ? WC() : null;
		$session = $woo->session ?? null;
		if ( ! $session || ! method_exists( $session, 'get_customer_id' ) ) return null;
		$session_id = (string) $session->get_customer_id();
		if ( '' === $session_id ) return null;
		$installation = ( new InstallationStore() )->read();
		if ( 'valid' !== ( $installation['state'] ?? null ) ) return null;
		$record = $installation['record'];
		$user_id = function_exists( 'get_current_user_id' ) ? (int) get_current_user_id() : 0;
		return array(
			'session' => $session, 'userId' => $user_id,
			'principal' => hash( 'sha256', $session_id . '|' . $user_id ),
			'shopId' => $record['shopId'], 'installationId' => $record['installationId'],
			'credentialVersion' => $record['credentialVersion'],
		);
	}

	private function digest( string $shop_id, string $phone ): ?string {
		if ( ! function_exists( 'wp_salt' ) ) return null;
		$salt = wp_salt( 'auth' );
		return is_string( $salt ) && strlen( $salt ) >= 16
			? hash_hmac( 'sha256', $shop_id . ':' . $phone, $salt ) : null;
	}
}
