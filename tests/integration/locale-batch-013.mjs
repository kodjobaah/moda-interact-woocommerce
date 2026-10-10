import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compileCatalogues } from '../../scripts/i18n/compile.mjs';

const fixtureAssets = 'tests/integration/.woo013-localization-assets';
const localeExpectations = {
	ja: {
		php: 'このセクションはまだ WooCommerce では利用できません。',
		save: 'カテゴリを保存',
		billing: '請求',
	},
	ko_KR: {
		php: '이 섹션은 아직 WooCommerce에서 사용할 수 없습니다.',
		save: '카테고리 저장',
		billing: '청구',
	},
	th: {
		php: 'ส่วนนี้ยังไม่พร้อมใช้งานสำหรับ WooCommerce',
		save: 'บันทึกหมวดหมู่',
		billing: 'การเรียกเก็บเงิน',
	},
	zh_CN: {
		php: '此版块暂不支持 WooCommerce。',
		save: '保存类别',
		billing: '账单',
	},
	zh_TW: {
		php: '此區段尚未支援 WooCommerce。',
		save: '儲存類別',
		billing: '帳務',
	},
};

/**
 * Exercise native gettext and script translations using the signed-in
 * administrator's personal UI language without modifying the store locale.
 * @param {Object}                        options                 WordPress integration harness.
 * @param {(...args: string[]) => string} options.wp              Execute WP-CLI.
 * @param {(output: string) => unknown}   options.parseJsonOutput Parse WP-CLI JSON.
 * @param {string}                        options.repository      Plugin checkout root.
 */
export function assertLocaleBatch013({ wp, parseJsonOutput, repository }) {
	const destination = resolve(repository, fixtureAssets);
	mkdirSync(destination, { recursive: true });
	try {
		compileCatalogues({
			languagesDirectory: join(repository, 'languages'),
			outputDirectory: destination,
			strict: true,
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
    foreach ( array( 'ja', 'ko_KR', 'th', 'zh_CN', 'zh_TW' ) as $locale ) {
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
