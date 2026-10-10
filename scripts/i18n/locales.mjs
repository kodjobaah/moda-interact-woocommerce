/**
 * Translation-pack coverage, not a restriction on WordPress or CommerceAgent locales.
 * WordPress looks up each compiled asset using determine_locale(). Additional WordPress
 * variants must be intentionally reviewed before adding them to a language's aliases.
 */
export const SUPPORTED_LOCALES = Object.freeze([
	{ tag: 'en', wordpress: ['en_US', 'en_GB'] },
	{ tag: 'fr', wordpress: ['fr_FR'] },
	{ tag: 'de', wordpress: ['de_DE'] },
	{ tag: 'it', wordpress: ['it_IT'] },
	{ tag: 'es', wordpress: ['es_ES'] },
	{ tag: 'nl', wordpress: ['nl_NL'] },
	{ tag: 'da', wordpress: ['da_DK'] },
	{ tag: 'fi', wordpress: ['fi'] },
	{ tag: 'nb', wordpress: ['nb_NO'] },
	{ tag: 'sv', wordpress: ['sv_SE'] },
	{ tag: 'cs', wordpress: ['cs_CZ'] },
	{ tag: 'pl', wordpress: ['pl_PL'] },
	{ tag: 'tr', wordpress: ['tr_TR'] },
	{ tag: 'pt-BR', wordpress: ['pt_BR'] },
	{ tag: 'pt-PT', wordpress: ['pt_PT'] },
	{ tag: 'ja', wordpress: ['ja'] },
	{ tag: 'ko', wordpress: ['ko_KR'] },
	{ tag: 'th', wordpress: ['th'] },
	{ tag: 'zh-Hans', wordpress: ['zh_CN'] },
	{ tag: 'zh-Hant', wordpress: ['zh_TW'] },
]);

/**
 * Map a WordPress locale to a shipped language pack, or English source fallback.
 * @param {string} locale
 */
export function catalogueForWordPressLocale(locale) {
	const normalized =
		typeof locale === 'string' ? locale.replace('-', '_') : '';
	return (
		SUPPORTED_LOCALES.find((item) => item.wordpress.includes(normalized)) ??
		SUPPORTED_LOCALES[0]
	);
}

/**
 * Only an explicit user UI override wins over the site's WordPress locale.
 * Unsupported user locales safely fall back to the English source messages.
 * This is an offline/test helper: WordPress determines the live admin locale.
 * @param {string|undefined|null} userOverride
 * @param {string}                siteLocale
 */
export function resolveUiCatalogue(userOverride, siteLocale) {
	const requested = userOverride || siteLocale;
	return catalogueForWordPressLocale(requested);
}
