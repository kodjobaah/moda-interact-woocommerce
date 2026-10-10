import assert from 'node:assert/strict';
import {
	readFileSync,
	mkdtempSync,
	rmSync,
	copyFileSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// eslint-disable-next-line vitest/no-import-node-test -- This suite runs with node --test.
import { test } from 'node:test';
import { compileCatalogues } from '../../scripts/i18n/compile.mjs';
import {
	originalKey,
	parsePo,
	poFromFile,
} from '../../scripts/i18n/gettext.mjs';

const languagesDirectory = resolve(import.meta.dirname, '../../languages');
const sourceKeys = new Set(
	poFromFile(join(languagesDirectory, 'moda-interact.pot'))
		.filter((entry) => entry.id)
		.map(originalKey)
);
const locales = [
	{
		code: 'fr_FR',
		save: 'Enregistrer la catégorie',
		php: 'Cette section n’est pas encore disponible pour WooCommerce.',
		billing: 'Facturation',
		support: 'Assistance',
	},
	{
		code: 'de_DE',
		save: 'Kategorie speichern',
		php: 'Dieser Bereich ist für WooCommerce noch nicht verfügbar.',
		billing: 'Abrechnung',
		support: 'Hilfe',
	},
	{
		code: 'it_IT',
		save: 'Salva categoria',
		php: 'Questa sezione non è ancora disponibile per WooCommerce.',
		billing: 'Fatturazione',
		support: 'Assistenza',
	},
	{
		code: 'es_ES',
		save: 'Guardar categoría',
		php: 'Esta sección todavía no está disponible para WooCommerce.',
		billing: 'Facturación',
		support: 'Soporte',
	},
];

function withOutput(callback) {
	const output = mkdtempSync(join(tmpdir(), 'moda-woo010-'));
	try {
		return callback(output);
	} finally {
		rmSync(output, { recursive: true, force: true });
	}
}

function moEntries(buffer) {
	assert.equal(buffer.readUInt32LE(0), 0x950412de);
	const count = buffer.readUInt32LE(8);
	const sourceIndex = buffer.readUInt32LE(12);
	const translationIndex = buffer.readUInt32LE(16);
	const result = new Map();
	for (let index = 0; index < count; index++) {
		const sourceLength = buffer.readUInt32LE(sourceIndex + index * 8);
		const sourceOffset = buffer.readUInt32LE(sourceIndex + index * 8 + 4);
		const valueLength = buffer.readUInt32LE(translationIndex + index * 8);
		const valueOffset = buffer.readUInt32LE(
			translationIndex + index * 8 + 4
		);
		result.set(
			buffer.toString('utf8', sourceOffset, sourceOffset + sourceLength),
			buffer.toString('utf8', valueOffset, valueOffset + valueLength)
		);
	}
	return result;
}

test('WOO-010 covers every current gettext key without untranslated English fallbacks', () => {
	assert.equal(sourceKeys.size, 169);
	const unchangedNames = new Set(['Moda Interact', 'WooCommerce', 'Free']);
	const validSharedTerms = new Map([
		['fr_FR', new Set(['Promotions'])],
		['de_DE', new Set(['%1$s: %2$s', 'Name'])],
		['it_IT', new Set(['%1$s: %2$s'])],
		['es_ES', new Set(['%1$s: %2$s', 'Plan'])],
	]);
	for (const { code } of locales) {
		const entries = poFromFile(
			join(languagesDirectory, `moda-interact-${code}.po`)
		);
		const translations = new Map(
			entries
				.filter((entry) => entry.id)
				.map((entry) => [originalKey(entry), entry])
		);
		assert.deepEqual(new Set(translations.keys()), sourceKeys, code);
		for (const [key, entry] of translations) {
			assert.ok(entry.translations[0], `${code}: untranslated ${key}`);
			assert.ok(!entry.fuzzy, `${code}: unreviewed ${key}`);
			assert.ok(
				unchangedNames.has(entry.id) ||
					validSharedTerms.get(code)?.has(entry.id) ||
					entry.id !== entry.translations[0],
				`${code}: English fallback ${key}`
			);
		}
		assert.match(entries[0].translations[0], /Plural-Forms: nplurals=2;/);
	}
});

test('WOO-010 emits complete PHP gettext and WordPress JavaScript catalogues', () => {
	withOutput((output) => {
		const compiled = compileCatalogues({
			languagesDirectory,
			outputDirectory: output,
		});
		assert.equal(compiled.requiredMessages, sourceKeys.size);
		assert.deepEqual(
			compiled.translatedLanguages.filter((tag) =>
				['fr', 'de', 'it', 'es'].includes(tag)
			),
			['fr', 'de', 'it', 'es']
		);
		assert.equal(
			compiled.assets.length,
			compiled.translatedLanguages.length * 2
		);
		for (const { code, save, php, billing, support } of locales) {
			const mo = moEntries(
				readFileSync(join(output, `moda-interact-${code}.mo`))
			);
			assert.equal(
				mo.get('This section is not yet available for WooCommerce.'),
				php
			);
			assert.equal(mo.get('Save category'), save);
			assert.equal(mo.get('Billing'), billing);
			assert.equal(mo.get('Support'), support);
			const json = JSON.parse(
				readFileSync(
					join(output, `moda-interact-${code}-moda-interact.json`),
					'utf8'
				)
			);
			assert.equal(json.locale_data.messages['Save category'][0], save);
			assert.equal(json.locale_data.messages.Billing[0], billing);
			assert.equal(
				json.locale_data.messages.Support,
				undefined,
				'PHP-only navigation labels must not appear in JavaScript assets'
			);
			assert.match(
				json.locale_data.messages['Effective value: %d minutes'][0],
				/%d/
			);
			assert.equal(
				json.locale_data.messages[
					'This section is not yet available for WooCommerce.'
				],
				undefined,
				'PHP-only strings must not be duplicated into JavaScript'
			);
		}
	});
});

test('WOO-010 rejects missing translations and broken printf placeholders', () => {
	for (const defect of ['missing', 'placeholder']) {
		withOutput((directory) => {
			copyFileSync(
				join(languagesDirectory, 'moda-interact.pot'),
				join(directory, 'moda-interact.pot')
			);
			const source = readFileSync(
				join(languagesDirectory, 'moda-interact-fr_FR.po'),
				'utf8'
			);
			const broken =
				defect === 'missing'
					? source.replace(
							/msgstr "Enregistrer la catégorie"/,
							'msgstr ""'
						)
					: source.replace(
							'msgstr "Valeur effective : %d minutes"',
							'msgstr "Valeur effective : %s minutes"'
						);
			assert.notEqual(broken, source);
			writeFileSync(join(directory, 'moda-interact-fr_FR.po'), broken);
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
});

test('WOO-010 retains the original gettext keys without new namespaces', () => {
	for (const { code } of locales) {
		const entries = parsePo(
			readFileSync(
				join(languagesDirectory, `moda-interact-${code}.po`),
				'utf8'
			)
		);
		assert.ok(entries.every((entry) => entry.context === undefined));
		assert.equal(entries.length, sourceKeys.size + 1);
	}
});
