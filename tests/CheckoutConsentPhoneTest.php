<?php

use ModaInteract\WooCommerce\Checkout\CheckoutConsentPhone;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutConsentPhone.php';

/** Portable golden vectors from @modainteract/moda-interact-shared 2.5.0 identity/fixtures. */
final class CheckoutConsentPhoneTest extends TestCase {
	public function test_published_shared_250_phone_and_lifecycle_vectors(): void {
		$path = __DIR__ . '/fixtures/identity-v1.shared-2.5.0.json';
		self::assertSame( '0f5b16e3fac34e80c1fed814095bc8d2be9a46e69e5047378f8ef9d844f66e15', hash_file( 'sha256', $path ) );
		$data = json_decode( file_get_contents( $path ), true, 512, JSON_THROW_ON_ERROR );
		self::assertSame( 1, $data['schemaVersion'] );
		foreach ( $data['phoneCases'] as $case ) {
			$result = CheckoutConsentPhone::normalize( $case['input'], $case['verifiedCountryCode'] );
			if ( isset( $case['e164'] ) ) {
				self::assertSame( substr( $case['e164'], 1 ), $result, $case['id'] );
			} else {
				self::assertNull( $result, $case['id'] );
			}
		}
		foreach ( $data['recipientLifecycleCases'] as $case ) {
			self::assertFalse( $case['grantCarriesAcrossPrincipal'], $case['id'] );
		}
	}

	public function test_dialling_without_a_verified_country_fails_closed(): void {
		self::assertNull( CheckoutConsentPhone::normalize( '07400 123456' ) );
		self::assertNull( CheckoutConsentPhone::normalize( '+447400123456#42' ) );
		self::assertSame( '447400123456', CheckoutConsentPhone::normalize( '+44 (7400) 123456' ) );
	}
}
