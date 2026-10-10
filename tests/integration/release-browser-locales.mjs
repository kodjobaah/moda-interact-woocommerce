import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { SUPPORTED_LOCALES } from '../../scripts/i18n/locales.mjs';
import { poFromFile } from '../../scripts/i18n/gettext.mjs';

const sourceDirectory = resolve(import.meta.dirname, '../../languages');

function connectLabel(locale) {
	if (locale === 'en_US' || locale === 'en_GB' || locale === 'zz_ZZ') {
		return 'Connect Moda Interact';
	}
	const catalogue = poFromFile(
		join(sourceDirectory, `moda-interact-${locale}.po`)
	);
	const entry = catalogue.find((item) => item.id === 'Connect Moda Interact');
	assert.ok(entry, `${locale} missing translated Connect button`);
	return entry.translations[0];
}

/**
 * Verify that the installed production ZIP renders a real localized React
 * connection button in the WordPress admin, not only an offline JSON string.
 *
 * @param {Object}                           options                 Browser locale test options.
 * @param {import('playwright').BrowserType} options.chromium        Playwright runtime.
 * @param {(...args: string[]) => string}    options.wp              WordPress command adapter.
 * @param {(output: string) => unknown}      options.parseJsonOutput WP-CLI parser.
 * @param {string}                           options.siteUrl         Installed WordPress base URL.
 * @param {string}                           options.loginToken      Authenticated disposable admin fixture token.
 */
export async function assertReleaseBrowserLocales({
	chromium,
	wp,
	parseJsonOutput,
	siteUrl,
	loginToken,
}) {
	const original = parseJsonOutput(
		wp(
			'eval',
			'echo wp_json_encode(array("locale" => get_user_meta(1, "locale", true), "site" => get_locale(), "connection" => hash("sha256", serialize(get_option("moda_interact_woocommerce_connection", null)))));'
		)
	);
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(
			`${siteUrl}/wp-login.php?moda_w006_test_login=${loginToken}`
		);
		const locales = [
			...SUPPORTED_LOCALES.flatMap((item) => item.wordpress),
			'zz_ZZ',
		];
		for (const locale of locales) {
			wp('eval', `update_user_meta(1, 'locale', '${locale}');`);
			await page.goto(
				`${siteUrl}/wp-admin/admin.php?page=wc-admin&path=%2Fmoda-interact`
			);
			await page
				.getByRole('button', {
					name: connectLabel(locale),
					exact: true,
				})
				.waitFor({ timeout: 20000 });
		}
	} finally {
		const originalLocale = String(original.locale ?? '');
		if (originalLocale) {
			assert.match(originalLocale, /^[A-Za-z0-9_-]+$/);
			wp('eval', `update_user_meta(1, 'locale', '${originalLocale}');`);
		} else {
			wp('eval', 'delete_user_meta(1, "locale");');
		}
		await browser.close();
	}
	const after = parseJsonOutput(
		wp(
			'eval',
			'echo wp_json_encode(array("locale" => get_user_meta(1, "locale", true), "site" => get_locale(), "connection" => hash("sha256", serialize(get_option("moda_interact_woocommerce_connection", null)))));'
		)
	);
	assert.deepEqual(
		after,
		original,
		'locale smoke changed store or connection state'
	);
}
