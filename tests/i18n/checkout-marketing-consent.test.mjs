import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { makeMo, poFromFile } from '../../scripts/i18n/gettext.mjs';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const label = 'Send me WhatsApp shopping updates, reminders and offers.';
const locales = [
	'cs_CZ',
	'da_DK',
	'de_DE',
	'es_ES',
	'fi',
	'fr_FR',
	'it_IT',
	'ja',
	'ko_KR',
	'nb_NO',
	'nl_NL',
	'pl_PL',
	'pt_BR',
	'pt_PT',
	'sv_SE',
	'th',
	'tr_TR',
	'zh_CN',
	'zh_TW',
];

test('short consent label is a translated, merchant-name-free source key in all 19 locale catalogues', () => {
	const template = poFromFile(join(root, 'languages/moda-interact.pot'));
	assert.ok(
		template.some((entry) => entry.id === label),
		'POT must include the customer-visible label'
	);
	for (const locale of locales) {
		const entries = poFromFile(
			join(root, `languages/moda-interact-${locale}.po`)
		);
		const entry = entries.find((candidate) => candidate.id === label);
		assert.ok(entry, `${locale}: missing consent label`);
		assert.ok(entry.translations[0], `${locale}: empty translated label`);
		assert.ok(
			entry.translations[0].includes('WhatsApp'),
			`${locale}: preserve WhatsApp branding`
		);
		assert.ok(
			!entry.translations[0].includes('%s'),
			`${locale}: no merchant name placeholder`
		);
		assert.notEqual(
			entry.translations[0],
			label,
			`${locale}: untranslated text`
		);
		// Production compiles MO from these reviewed PO sources.
		const compiled = makeMo(entries);
		assert.ok(
			compiled.includes(Buffer.from(label, 'utf8')),
			`${locale}: compiled translation missing source`
		);
		assert.ok(
			compiled.includes(Buffer.from(entry.translations[0], 'utf8')),
			`${locale}: compiled translation missing localized label`
		);
	}
});
