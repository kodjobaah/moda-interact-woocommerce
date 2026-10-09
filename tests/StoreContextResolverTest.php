<?php

use ModaInteract\WooCommerce\StoreContext\StoreContextResolver;
use PHPUnit\Framework\TestCase;

final class StoreContextResolverTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_store_locale'] = 'fr_FR'; // Simulates administrator UI locale.
		$GLOBALS['moda_interact_options']['WPLANG'] = 'en_GB';
		$GLOBALS['moda_interact_base_location'] = array( 'country' => 'GB', 'state' => 'LND' );
		$GLOBALS['moda_interact_options']['timezone_string'] = 'Europe/London';
	}

	public function test_reads_actual_uk_store_settings_without_admin_locale(): void {
		self::assertSame( array(
			'schemaVersion' => 1,
			'storeLocale' => 'en_GB',
			'languageTag' => 'en-GB',
			'timeZone' => 'Europe/London',
			'countryCode' => 'GB',
		), ( new StoreContextResolver() )->resolve() );
	}

	public function test_preserves_locale_variants_without_guessing_language_or_country(): void {
		$GLOBALS['moda_interact_options']['WPLANG'] = 'sr_RS@latin';
		$GLOBALS['moda_interact_base_location'] = array( 'country' => '', 'state' => '' );
		self::assertSame( array(
			'schemaVersion' => 1,
			'storeLocale' => 'sr_RS@latin',
			'languageTag' => null,
			'timeZone' => 'Europe/London',
			'countryCode' => null,
		), ( new StoreContextResolver() )->resolve() );
	}

	public function test_supported_language_and_script_identities_are_safe(): void {
		foreach ( array(
			'pt_BR' => 'pt-BR',
			'zh_Hant' => 'zh-Hant',
			'zh_Hans_TW' => 'zh-Hans-TW',
			'fr' => 'fr',
			'de_DE_formal' => null,
			'en_GB@x' => null,
		) as $source => $expected ) {
			$GLOBALS['moda_interact_options']['WPLANG'] = $source;
			self::assertSame( $expected, ( new StoreContextResolver() )->resolve()['languageTag'], $source );
		}
	}

	public function test_utc_offset_and_empty_site_zone_cannot_be_sent_as_iana_zone(): void {
		foreach ( array( '', 'UTC+2', '+02:00', 'Invalid/Zone' ) as $zone ) {
			$GLOBALS['moda_interact_options']['timezone_string'] = $zone;
			self::assertNull( ( new StoreContextResolver() )->resolve()['timeZone'], $zone );
		}
		$GLOBALS['moda_interact_options']['timezone_string'] = 'UTC';
		self::assertSame( 'UTC', ( new StoreContextResolver() )->resolve()['timeZone'] );
	}

	public function test_does_not_guess_missing_language_locale_or_woocommerce_country(): void {
		$GLOBALS['moda_interact_options']['WPLANG'] = 'not a locale';
		$GLOBALS['moda_interact_base_location'] = array( 'country' => '??' );
		$snapshot = ( new StoreContextResolver() )->resolve();
		self::assertNull( $snapshot['storeLocale'] );
		self::assertNull( $snapshot['languageTag'] );
		self::assertNull( $snapshot['countryCode'] );
	}

	public function test_unset_wordpress_site_locale_uses_core_default_not_admin_language(): void {
		unset( $GLOBALS['moda_interact_options']['WPLANG'] );
		$GLOBALS['moda_interact_store_locale'] = 'fr_FR';
		$snapshot = ( new StoreContextResolver() )->resolve();
		self::assertSame( 'en_US', $snapshot['storeLocale'] );
		self::assertSame( 'en-US', $snapshot['languageTag'] );
	}

}
