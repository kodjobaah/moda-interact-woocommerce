import assert from 'node:assert/strict';
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// eslint-disable-next-line vitest/no-import-node-test -- This suite runs with node --test.
import { test } from 'node:test';
import { compileCatalogues } from '../../scripts/i18n/compile.mjs';
import { originalKey, poFromFile } from '../../scripts/i18n/gettext.mjs';
import {
	catalogueForWordPressLocale,
	resolveUiCatalogue,
} from '../../scripts/i18n/locales.mjs';

const languagesDirectory = resolve(import.meta.dirname, '../../languages');
const sourceKeys = new Set(
	poFromFile(join(languagesDirectory, 'moda-interact.pot'))
		.filter((entry) => entry.id)
		.map(originalKey)
);
const batch = [
	{
		tag: 'nl',
		locale: 'nl_NL',
		php: 'Dit onderdeel is nog niet beschikbaar voor WooCommerce.',
		save: 'Categorie opslaan',
		billing: 'Facturering',
	},
	{
		tag: 'da',
		locale: 'da_DK',
		php: 'Dette afsnit er endnu ikke tilgængeligt for WooCommerce.',
		save: 'Gem kategori',
		billing: 'Fakturering',
	},
	{
		tag: 'fi',
		locale: 'fi',
		php: 'Tämä osio ei ole vielä käytettävissä WooCommercessa.',
		save: 'Tallenna luokka',
		billing: 'Laskutus',
	},
	{
		tag: 'nb',
		locale: 'nb_NO',
		php: 'Denne delen er ennå ikke tilgjengelig for WooCommerce.',
		save: 'Lagre kategori',
		billing: 'Fakturering',
	},
	{
		tag: 'sv',
		locale: 'sv_SE',
		php: 'Det här avsnittet är ännu inte tillgängligt för WooCommerce.',
		save: 'Spara kategori',
		billing: 'Fakturering',
	},
];

function inTemporaryDirectory(callback) {
	const directory = mkdtempSync(join(tmpdir(), 'moda-woo011-'));
	try {
		return callback(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function readMo(buffer) {
	assert.equal(buffer.readUInt32LE(0), 0x950412de);
	const count = buffer.readUInt32LE(8);
	const idIndex = buffer.readUInt32LE(12);
	const valueIndex = buffer.readUInt32LE(16);
	const entries = new Map();
	for (let index = 0; index < count; index++) {
		const idLength = buffer.readUInt32LE(idIndex + index * 8);
		const idOffset = buffer.readUInt32LE(idIndex + index * 8 + 4);
		const valueLength = buffer.readUInt32LE(valueIndex + index * 8);
		const valueOffset = buffer.readUInt32LE(valueIndex + index * 8 + 4);
		entries.set(
			buffer.toString('utf8', idOffset, idOffset + idLength),
			buffer.toString('utf8', valueOffset, valueOffset + valueLength)
		);
	}
	return entries;
}

test('WOO-011 catalogues cover all 169 source keys, with no accidental English fallbacks', () => {
	assert.equal(sourceKeys.size, 169);
	const productNames = new Set([
		'Moda Interact',
		'WooCommerce',
		'Free',
		'%1$s: %2$s',
	]);
	for (const { locale } of batch) {
		const entries = poFromFile(
			join(languagesDirectory, `moda-interact-${locale}.po`)
		);
		const translations = entries.filter((entry) => entry.id);
		assert.deepEqual(
			new Set(translations.map(originalKey)),
			sourceKeys,
			locale
		);
		assert.equal(entries.length, 170, locale);
		assert.match(entries[0].translations[0], /Plural-Forms: nplurals=2;/);
		for (const entry of translations) {
			assert.ok(entry.translations[0], `${locale}: ${entry.id}`);
			assert.ok(!entry.fuzzy, `${locale}: fuzzy ${entry.id}`);
			assert.ok(
				productNames.has(entry.id) ||
					entry.id !== entry.translations[0],
				`${locale}: English fallback ${entry.id}`
			);
		}
	}
});

test('WOO-011 produces real PHP MO and handle-specific JavaScript translations', () => {
	inTemporaryDirectory((directory) => {
		const compiled = compileCatalogues({
			languagesDirectory,
			outputDirectory: directory,
		});
		assert.deepEqual(
			compiled.translatedLanguages.filter((tag) =>
				batch.some((entry) => entry.tag === tag)
			),
			batch.map((entry) => entry.tag)
		);
		assert.equal(
			compiled.assets.length,
			compiled.translatedLanguages.length * 2
		);
		for (const { locale, php, save, billing } of batch) {
			const mo = readMo(
				readFileSync(join(directory, `moda-interact-${locale}.mo`))
			);
			assert.equal(
				mo.get('This section is not yet available for WooCommerce.'),
				php
			);
			assert.equal(mo.get('Save category'), save);
			const script = JSON.parse(
				readFileSync(
					join(
						directory,
						`moda-interact-${locale}-moda-interact.json`
					),
					'utf8'
				)
			);
			assert.equal(script.locale_data.messages['Save category'][0], save);
			assert.equal(script.locale_data.messages.Billing[0], billing);
			assert.match(
				script.locale_data.messages['Effective value: %d minutes'][0],
				/%d/
			);
			assert.equal(
				script.locale_data.messages[
					'This section is not yet available for WooCommerce.'
				],
				undefined
			);
		}
	});
});

test('WOO-011 rejects a missing translation or a corrupted printf placeholder', () => {
	for (const { locale, save } of batch) {
		for (const defect of ['missing', 'placeholder']) {
			inTemporaryDirectory((directory) => {
				copyFileSync(
					join(languagesDirectory, 'moda-interact.pot'),
					join(directory, 'moda-interact.pot')
				);
				const source = readFileSync(
					join(languagesDirectory, `moda-interact-${locale}.po`),
					'utf8'
				);
				const broken =
					defect === 'missing'
						? source.replace(`msgstr "${save}"`, 'msgstr ""')
						: source.replace(/^msgstr ".*%d.*"$/m, (line) =>
								line.replace('%d', '%s')
							);
				assert.notEqual(broken, source, `${locale}: ${defect}`);
				writeFileSync(
					join(directory, `moda-interact-${locale}.po`),
					broken
				);
				assert.throws(
					() =>
						compileCatalogues({
							languagesDirectory: directory,
							outputDirectory: join(directory, 'output'),
						}),
					/missing translation|placeholder mismatch/
				);
			});
		}
	}
});

test('WOO-011 WordPress administrator locales do not change the store locale', () => {
	for (const { locale, tag } of batch) {
		assert.equal(catalogueForWordPressLocale(locale).tag, tag);
		assert.equal(resolveUiCatalogue(locale, 'en_GB').tag, tag);
	}
	assert.equal(resolveUiCatalogue('xx_XX', 'sv_SE').tag, 'en');
});
