<?php

namespace ModaInteract\WooCommerce\StoreContext;

defined( 'ABSPATH' ) || exit;

/** Read the store's own settings, not the administrator's UI preferences. */
final class StoreContextResolver {
	public function resolve(): array {
		// REST ?_locale=user can switch get_locale() to the administrator's UI language.
		// Read the site configuration directly; WordPress defaults an unset WPLANG to en_US.
		$site_locale = get_option( 'WPLANG', '' );
		if ( ! is_string( $site_locale ) || '' === $site_locale ) {
			$site_locale = defined( 'WPLANG' ) && is_string( WPLANG ) && '' !== WPLANG ? WPLANG : 'en_US';
		}
		$locale = strlen( $site_locale ) <= 128 && preg_match( '/^[A-Za-z][A-Za-z0-9_.@-]*$/D', $site_locale ) ? $site_locale : null;

		$zone = get_option( 'timezone_string', '' );
		$zone = is_string( $zone ) && '' !== $zone && strlen( $zone ) <= 255 &&
			! preg_match( '/^(?:UTC|GMT)[+-]/i', $zone ) &&
			in_array( $zone, \DateTimeZone::listIdentifiers( \DateTimeZone::ALL_WITH_BC ), true ) ? $zone : null;

		$country = null;
		if ( function_exists( 'wc_get_base_location' ) ) {
			$base = wc_get_base_location();
			if ( is_array( $base ) && isset( $base['country'] ) && is_string( $base['country'] ) ) {
				$candidate = strtoupper( $base['country'] );
				if ( preg_match( '/^[A-Z]{2}$/D', $candidate ) ) {
					$country = $candidate;
				}
			}
		}

		return array(
			'schemaVersion' => 1,
			'storeLocale'   => $locale,
			'languageTag'   => self::languageTag( $locale ),
			'timeZone'      => $zone,
			'countryCode'   => $country,
		);
	}

	/** Only normalize simple unambiguous WordPress locale forms. */
	private static function languageTag( ?string $locale ): ?string {
		if ( null === $locale ) {
			return null;
		}
		if ( preg_match( '/^[a-z]{2,3}$/D', $locale ) ) {
			return $locale;
		}
		if ( preg_match( '/^([a-z]{2,3})_([A-Z]{2}|[0-9]{3})$/D', $locale, $matches ) ||
			preg_match( '/^([a-z]{2,3})_([A-Z][a-z]{3})$/D', $locale, $matches ) ) {
			return $matches[1] . '-' . $matches[2];
		}
		if ( preg_match( '/^([a-z]{2,3})_([A-Z][a-z]{3})_([A-Z]{2}|[0-9]{3})$/D', $locale, $matches ) ) {
			return $matches[1] . '-' . $matches[2] . '-' . $matches[3];
		}
		return null;
	}
}
