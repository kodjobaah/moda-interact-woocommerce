import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compileCatalogues } from '../../scripts/i18n/compile.mjs';

const testAssets = 'tests/integration/.localization-fixture-assets';

/**
 * Run inside the existing disposable wp-env fixture, after plugin activation.
 * A French administrator and English store must remain separate. The fixture
 * tests PHP gettext and the exact WordPress JS handle lookup path.
 *
 * @param {Object}                        options                 WordPress fixture adapters.
 * @param {(...args: string[]) => string} options.wp              Executes WP-CLI.
 * @param {(output: string) => unknown}   options.parseJsonOutput Extracts JSON.
 * @param {string}                        options.repository      Root of the mounted plugin checkout.
 */
export function assertLocaleWordPress({ wp, parseJsonOutput, repository }) {
	const destination = resolve(repository, testAssets);
	mkdirSync(destination, { recursive: true });
	try {
		const languagesDirectory = join(repository, 'tests/fixtures/i18n');
		compileCatalogues({ languagesDirectory, outputDirectory: destination });
		const result = parseJsonOutput(
			wp(
				'eval',
				`
$administrator = get_users( array( 'role' => 'administrator', 'number' => 1 ) )[0];
$previous_user = get_current_user_id();
$previous_locale = get_user_meta( $administrator->ID, 'locale', true );
$fixture = dirname( MODA_INTERACT_MAIN_PLUGIN_FILE ) . '/${testAssets}';
try {
    update_user_meta( $administrator->ID, 'locale', 'fr_FR' );
    wp_set_current_user( $administrator->ID );
    $admin_locale = get_user_locale();
    $site_locale = get_locale();
    add_filter( 'determine_locale', static function () { return get_user_locale(); } );
    unload_textdomain( 'moda-interact', true );
    load_textdomain( 'moda-interact', $fixture . '/moda-interact-fr_FR.mo', 'fr_FR' );
    $php = __( 'Overview', 'moda-interact' );
    wp_register_script( 'moda-interact', plugins_url( '/build/index.js', MODA_INTERACT_MAIN_PLUGIN_FILE ), array( 'wp-i18n' ), 'test', true );
    wp_set_script_translations( 'moda-interact', 'moda-interact', $fixture );
    $browser = load_script_textdomain( 'moda-interact', 'moda-interact', $fixture );
    $json = is_string( $browser ) ? json_decode( $browser, true ) : null;
    echo wp_json_encode( array(
        'user' => $admin_locale,
        'site' => $site_locale,
        'php' => $php,
        'browser' => $json['locale_data']['messages']['Save category'][0] ?? null,
    ) );
} finally {
    if ( $previous_locale ) { update_user_meta( $administrator->ID, 'locale', $previous_locale ); }
    else { delete_user_meta( $administrator->ID, 'locale' ); }
    wp_set_current_user( $previous_user );
}
`
			)
		);
		assert.deepEqual(result, {
			user: 'fr_FR',
			site: 'en_GB',
			php: 'Vue d’ensemble',
			browser: 'Enregistrer la catégorie',
		});
	} finally {
		rmSync(destination, { recursive: true, force: true });
	}
}
