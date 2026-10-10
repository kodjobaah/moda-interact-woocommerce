import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { SUPPORTED_LOCALES } from '../../scripts/i18n/locales.mjs';
import { poFromFile } from '../../scripts/i18n/gettext.mjs';

const languages = resolve(import.meta.dirname, '../../languages');
const phpMessage = 'This section is not yet available for WooCommerce.';
const jsMessages = ['Save category', 'Billing'];
const locales = SUPPORTED_LOCALES.flatMap(({ wordpress }) => wordpress);
const unsupportedLocale = 'zz_ZZ';

function translatedValue(locale, message) {
	if (
		locale === 'en_US' ||
		locale === 'en_GB' ||
		locale === unsupportedLocale
	) {
		return message;
	}
	const catalogue = poFromFile(join(languages, `moda-interact-${locale}.po`));
	const entry = catalogue.find((item) => item.id === message);
	assert.ok(entry, `${locale} source key missing: ${message}`);
	return entry.translations[0];
}

/**
 * Exercise the actual installed plugin script registration and its bundled
 * gettext/JS translations in disposable WordPress. This never changes Shop data.
 *
 * @param {Object}                      options                  WordPress locale test options.
 * @param {(php: string) => string}     options.wpEval           Execute WP-CLI eval.
 * @param {(output: string) => unknown} options.parseJsonOutput  Parse WP-CLI JSON.
 * @param {() => unknown}               [options.getRemoteState] Read mock-hosted state counters.
 */
export function assertReleaseLocales({
	wpEval,
	parseJsonOutput,
	getRemoteState,
}) {
	const before = getRemoteState ? structuredClone(getRemoteState()) : null;
	const all = [...locales, unsupportedLocale];
	const requested = all.map((locale) => `'${locale}'`).join(', ');
	const records = parseJsonOutput(
		wpEval(`
$admin = get_users( array( 'role' => 'administrator', 'number' => 1 ) )[0];
$original_user = get_current_user_id();
$original_locale = get_user_meta( $admin->ID, 'locale', true );
$site_locale = get_locale();
$plugin_directory = dirname( MODA_INTERACT_MAIN_PLUGIN_FILE );
$original_state = array(
    'WPLANG' => get_option( 'WPLANG', null ),
    'connection' => get_option( 'moda_interact_woocommerce_connection', null ),
    'country' => get_option( 'woocommerce_default_country', null ),
    'currency' => get_option( 'woocommerce_currency', null ),
);
$results = array();
$locale_override = static function () { return get_user_locale(); };
try {
    wp_set_current_user( $admin->ID );
    if ( ! function_exists( 'set_current_screen' ) ) {
        require_once ABSPATH . 'wp-admin/includes/screen.php';
    }
    set_current_screen( 'woocommerce_page_wc-admin' );
    // WP-CLI is not an admin request; the plugin's admin-only Setup is not
    // bootstrapped there. Exercise its actual asset registration directly,
    // without triggering unrelated WooCommerce admin_enqueue_scripts hooks.
    $setup = new \\ModaInteract\\WooCommerce\\Admin\\Setup();
    $setup->register_scripts();
    $script = wp_scripts()->registered['moda-interact'] ?? null;
    $registration = array(
        'actual_bundle' => $script && false !== strpos( (string) $script->src, '/build/index.js' ),
        'domain' => $script->textdomain ?? null,
        'translation_path' => $script->translations_path ?? null,
        'expected_path' => $plugin_directory . '/languages',
        'i18n_dependency' => $script && in_array( 'wp-i18n', $script->deps, true ),
    );
    add_filter( 'determine_locale', $locale_override );
    foreach ( array( ${requested} ) as $locale ) {
        update_user_meta( $admin->ID, 'locale', $locale );
        unload_textdomain( 'moda-interact', true );
        $mo = $plugin_directory . '/languages/moda-interact-' . $locale . '.mo';
        if ( is_file( $mo ) ) {
            load_textdomain( 'moda-interact', $mo, $locale );
        }
        $script_json = load_script_textdomain( 'moda-interact', 'moda-interact', $plugin_directory . '/languages' );
        $messages = is_string( $script_json ) ? json_decode( $script_json, true ) : null;
        $results[$locale] = array(
            'user' => get_user_locale(),
            'site' => get_locale(),
            'php' => __( '${phpMessage}', 'moda-interact' ),
            'save' => $messages['locale_data']['messages']['Save category'][0] ?? null,
            'billing' => $messages['locale_data']['messages']['Billing'][0] ?? null,
        );
    }
} finally {
    remove_filter( 'determine_locale', $locale_override );
    if ( $original_locale ) { update_user_meta( $admin->ID, 'locale', $original_locale ); }
    else { delete_user_meta( $admin->ID, 'locale' ); }
    unload_textdomain( 'moda-interact', true );
    wp_set_current_user( $original_user );
}
echo wp_json_encode( array(
    'metadata' => $registration,
    'results' => $results,
    'original_site' => $site_locale,
    'state_unchanged' => $original_state === array(
        'WPLANG' => get_option( 'WPLANG', null ),
        'connection' => get_option( 'moda_interact_woocommerce_connection', null ),
        'country' => get_option( 'woocommerce_default_country', null ),
        'currency' => get_option( 'woocommerce_currency', null ),
    ),
) );
`)
	);
	assert.equal(records.metadata?.actual_bundle, true);
	assert.equal(records.metadata?.domain, 'moda-interact');
	assert.equal(
		records.metadata?.translation_path,
		records.metadata?.expected_path,
		'translations must load from the installed plugin directory'
	);
	assert.equal(records.metadata?.i18n_dependency, true);
	assert.equal(
		records.state_unchanged,
		true,
		'locale switching mutated store options'
	);

	for (const locale of all) {
		assert.deepEqual(
			records.results?.[locale],
			{
				user: locale,
				site: records.original_site,
				php: translatedValue(locale, phpMessage),
				save:
					locales.includes(locale) && !locale.startsWith('en_')
						? translatedValue(locale, jsMessages[0])
						: null,
				billing:
					locales.includes(locale) && !locale.startsWith('en_')
						? translatedValue(locale, jsMessages[1])
						: null,
			},
			`${locale}: installed PHP/JS translations or English fallback failed`
		);
	}
	if (getRemoteState) {
		assert.deepEqual(
			structuredClone(getRemoteState()),
			before,
			'admin language switching must not write the hosted fixture state'
		);
	}
	return { locales: SUPPORTED_LOCALES.length, installed: true };
}
