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
		tag: 'cs',
		locale: 'cs_CZ',
		plural: 'nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;',
		php: 'Tato část zatím není pro WooCommerce dostupná.',
		save: 'Uložit kategorii',
		billing: 'Fakturace',
	},
	{
		tag: 'pl',
		locale: 'pl_PL',
		plural: 'nplurals=3; plural=(n==1) ? 0 : (n%10>=2 && n%10<=4 && (n%100<12 || n%100>14)) ? 1 : 2;',
		php: 'Ta sekcja nie jest jeszcze dostępna w WooCommerce.',
		save: 'Zapisz kategorię',
		billing: 'Rozliczenia',
	},
	{
		tag: 'tr',
		locale: 'tr_TR',
		plural: 'nplurals=2; plural=(n > 1);',
		php: 'Bu bölüm henüz WooCommerce için kullanılamıyor.',
		save: 'Kategoriyi kaydet',
		billing: 'Faturalandırma',
	},
	{
		tag: 'pt-BR',
		locale: 'pt_BR',
		plural: 'nplurals=2; plural=(n > 1);',
		php: 'Esta seção ainda não está disponível para o WooCommerce.',
		save: 'Salvar categoria',
		billing: 'Cobrança',
	},
	{
		tag: 'pt-PT',
		locale: 'pt_PT',
		plural: 'nplurals=2; plural=(n != 1);',
		php: 'Esta secção ainda não está disponível para o WooCommerce.',
		save: 'Guardar categoria',
		billing: 'Faturação',
	},
];

function inTemporaryDirectory(callback) {
	const directory = mkdtempSync(join(tmpdir(), 'moda-woo012-'));
	try {
		return callback(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function getMoTranslation(buffer, key) {
	assert.equal(buffer.readUInt32LE(0), 0x950412de);
	const count = buffer.readUInt32LE(8);
	const idIndex = buffer.readUInt32LE(12);
	const valueIndex = buffer.readUInt32LE(16);
	for (let index = 0; index < count; index++) {
		const idLength = buffer.readUInt32LE(idIndex + index * 8);
		const idOffset = buffer.readUInt32LE(idIndex + index * 8 + 4);
		if (buffer.toString('utf8', idOffset, idOffset + idLength) !== key) {
			continue;
		}
		const valueLength = buffer.readUInt32LE(valueIndex + index * 8);
		const valueOffset = buffer.readUInt32LE(valueIndex + index * 8 + 4);
		return buffer.toString('utf8', valueOffset, valueOffset + valueLength);
	}
	return undefined;
}

test('WOO-012 covers exactly 195 keys and locale plural rules', () => {
	assert.equal(sourceKeys.size, 195);
	const unchangedNames = new Set([
		'Moda Interact',
		'WooCommerce',
		'Free',
		'%1$s: %2$s',
	]);
	for (const { locale, plural } of batch) {
		const entries = poFromFile(
			join(languagesDirectory, `moda-interact-${locale}.po`)
		);
		assert.equal(entries.length, 196, locale);
		assert.deepEqual(
			new Set(entries.filter((item) => item.id).map(originalKey)),
			sourceKeys,
			locale
		);
		assert.ok(
			entries[0].translations[0].includes(`Plural-Forms: ${plural}`)
		);
		for (const entry of entries.filter((item) => item.id)) {
			assert.ok(entry.translations[0], `${locale}: ${entry.id}`);
			assert.ok(!entry.fuzzy, `${locale}: fuzzy: ${entry.id}`);
			assert.equal(entry.context, undefined, `${locale}: new namespace`);
			assert.ok(
				unchangedNames.has(entry.id) ||
					(['pl_PL', 'tr_TR'].includes(locale) &&
						entry.id === 'Plan') ||
					entry.id !== entry.translations[0],
				`${locale}: English fallback: ${entry.id}`
			);
		}
	}
});

test('WOO-012 compiles PHP gettext and JavaScript assets', () => {
	inTemporaryDirectory((directory) => {
		const result = compileCatalogues({
			languagesDirectory,
			outputDirectory: directory,
		});
		assert.deepEqual(
			result.translatedLanguages.filter((tag) =>
				batch.some(({ tag: entry }) => entry === tag)
			),
			batch.map(({ tag }) => tag)
		);
		assert.equal(
			result.assets.length,
			result.translatedLanguages.length * 2
		);
		for (const { locale, php, save, billing, plural } of batch) {
			const mo = readFileSync(
				join(directory, `moda-interact-${locale}.mo`)
			);
			assert.equal(
				getMoTranslation(
					mo,
					'This section is not yet available for WooCommerce.'
				),
				php
			);
			assert.equal(getMoTranslation(mo, 'Save category'), save);
			assert.ok(
				getMoTranslation(mo, '').includes(`Plural-Forms: ${plural}`)
			);
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
				undefined,
				'PHP-only messages must not be emitted in the JS catalogue'
			);
		}
	});
});

test('WOO-012 rejects missing values and altered placeholders', () => {
	for (const { locale, save } of batch) {
		for (const defect of ['missing-entry', 'blank', 'placeholder']) {
			inTemporaryDirectory((directory) => {
				copyFileSync(
					join(languagesDirectory, 'moda-interact.pot'),
					join(directory, 'moda-interact.pot')
				);
				const original = readFileSync(
					join(languagesDirectory, `moda-interact-${locale}.po`),
					'utf8'
				);
				let broken;
				if (defect === 'missing-entry') {
					broken = original.replace(
						/^msgid "Save category"\nmsgstr ".*"\n?/m,
						''
					);
				} else if (defect === 'blank') {
					broken = original.replace(`msgstr "${save}"`, 'msgstr ""');
				} else {
					broken = original.replace(/^msgstr ".*%d.*"$/m, (line) =>
						line.replace('%d', '%s')
					);
				}
				assert.notEqual(broken, original, `${locale}: ${defect}`);
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
					/missing source key|missing translation|placeholder mismatch/
				);
			});
		}
	}
});

test('WOO-012 distinguishes Portuguese regions and admin locales', () => {
	for (const { tag, locale } of batch) {
		assert.equal(catalogueForWordPressLocale(locale).tag, tag);
		assert.equal(resolveUiCatalogue(locale, 'en_GB').tag, tag);
	}
	assert.equal(resolveUiCatalogue('xx_XX', 'pt_PT').tag, 'en');
	const brazil = new Map(
		poFromFile(join(languagesDirectory, 'moda-interact-pt_BR.po'))
			.filter(({ id }) => id)
			.map(({ id, translations }) => [id, translations[0]])
	);
	const portugal = new Map(
		poFromFile(join(languagesDirectory, 'moda-interact-pt_PT.po'))
			.filter(({ id }) => id)
			.map(({ id, translations }) => [id, translations[0]])
	);
	for (const key of [
		'Billing',
		'Save category',
		'Support',
		'Cancel subscription',
		'Recovery settings',
		'This section is not yet available for WooCommerce.',
	]) {
		assert.notEqual(brazil.get(key), portugal.get(key), key);
	}
});
