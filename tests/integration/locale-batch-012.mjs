import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compileCatalogues } from '../../scripts/i18n/compile.mjs';

const fixtureAssets = 'tests/integration/.woo012-localization-assets';
const localeExpectations = {
	cs_CZ: {
		php: 'Tato část zatím není pro WooCommerce dostupná.',
		save: 'Uložit kategorii',
		billing: 'Fakturace',
	},
	pl_PL: {
		php: 'Ta sekcja nie jest jeszcze dostępna w WooCommerce.',
		save: 'Zapisz kategorię',
		billing: 'Rozliczenia',
	},
	tr_TR: {
		php: 'Bu bölüm henüz WooCommerce için kullanılamıyor.',
		save: 'Kategoriyi kaydet',
		billing: 'Faturalandırma',
	},
	pt_BR: {
		php: 'Esta seção ainda não está disponível para o WooCommerce.',
		save: 'Salvar categoria',
		billing: 'Cobrança',
	},
	pt_PT: {
		php: 'Esta secção ainda não está disponível para o WooCommerce.',
		save: 'Guardar categoria',
		billing: 'Faturação',
	},
};

/**
 * Validate native WordPress gettext and browser script translations while
 * changing only the logged-in administrator's UI language, not the site locale.
 * @param {Object}                        options                 WordPress integration harness.
 * @param {(...args: string[]) => string} options.wp              Execute WP-CLI.
 * @param {(output: string) => unknown}   options.parseJsonOutput Parse WP-CLI JSON.
 * @param {string}                        options.repository      Plugin checkout root.
 */
export function assertLocaleBatch012({ wp, parseJsonOutput, repository }) {
	const destination = resolve(repository, fixtureAssets);
	mkdirSync(destination, { recursive: true });
	try {
		compileCatalogues({
			languagesDirectory: join(repository, 'languages'),
			outputDirectory: destination,
		});
		const records = parseJsonOutput(
			wp(
				'eval',
				`
$administrator = get_users( array( 'role' => 'administrator', 'number' => 1 ) )[0];
$previous_user = get_current_user_id();
$previous_locale = get_user_meta( $administrator->ID, 'locale', true );
$fixture = dirname( MODA_INTERACT_MAIN_PLUGIN_FILE ) . '/${fixtureAssets}';
$records = array();
try {
    wp_set_current_user( $administrator->ID );
    add_filter( 'determine_locale', static function () { return get_user_locale(); } );
    foreach ( array( 'cs_CZ', 'pl_PL', 'tr_TR', 'pt_BR', 'pt_PT' ) as $locale ) {
        update_user_meta( $administrator->ID, 'locale', $locale );
        unload_textdomain( 'moda-interact', true );
        load_textdomain( 'moda-interact', $fixture . '/moda-interact-' . $locale . '.mo', $locale );
        $php = __( 'This section is not yet available for WooCommerce.', 'moda-interact' );
        wp_register_script( 'moda-interact', plugins_url( '/build/index.js', MODA_INTERACT_MAIN_PLUGIN_FILE ), array( 'wp-i18n' ), 'test', true );
        wp_set_script_translations( 'moda-interact', 'moda-interact', $fixture );
        $browser = load_script_textdomain( 'moda-interact', 'moda-interact', $fixture );
        $json = is_string( $browser ) ? json_decode( $browser, true ) : null;
        $records[$locale] = array(
            'user' => get_user_locale(),
            'site' => get_locale(),
            'php' => $php,
            'save' => $json['locale_data']['messages']['Save category'][0] ?? null,
            'billing' => $json['locale_data']['messages']['Billing'][0] ?? null,
        );
    }
} finally {
    if ( $previous_locale ) { update_user_meta( $administrator->ID, 'locale', $previous_locale ); }
    else { delete_user_meta( $administrator->ID, 'locale' ); }
    unload_textdomain( 'moda-interact', true );
    wp_set_current_user( $previous_user );
}
echo wp_json_encode( $records );
`
			)
		);
		for (const [locale, expected] of Object.entries(localeExpectations)) {
			assert.deepEqual(records[locale], {
				user: locale,
				site: 'en_GB',
				...expected,
			});
		}
	} finally {
		rmSync(destination, { recursive: true, force: true });
	}
}
