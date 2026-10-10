import assert from 'node:assert/strict';
import {
	readFileSync,
	writeFileSync,
	mkdtempSync,
	rmSync,
	copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// eslint-disable-next-line vitest/no-import-node-test -- This suite runs with node --test.
import { test } from 'node:test';
import { compileCatalogues } from '../../scripts/i18n/compile.mjs';
import {
	catalogueForWordPressLocale,
	resolveUiCatalogue,
	SUPPORTED_LOCALES,
} from '../../scripts/i18n/locales.mjs';
import { parsePo } from '../../scripts/i18n/gettext.mjs';

const fixtures = resolve(import.meta.dirname, '../fixtures/i18n');

function withFixture(run) {
	const output = mkdtempSync(join(tmpdir(), 'moda-i18n-'));
	try {
		const result = compileCatalogues({
			languagesDirectory: fixtures,
			outputDirectory: output,
		});
		return run({ output, result });
	} finally {
		rmSync(output, { recursive: true, force: true });
	}
}

test('20 canonical Shopify language tags map to distinct WordPress catalogue names', () => {
	assert.equal(SUPPORTED_LOCALES.length, 20);
	assert.equal(new Set(SUPPORTED_LOCALES.map((item) => item.tag)).size, 20);
	assert.equal(
		new Set(SUPPORTED_LOCALES.flatMap((item) => item.wordpress)).size,
		SUPPORTED_LOCALES.flatMap((item) => item.wordpress).length
	);
	for (const [wordPress, tag] of [
		['fr_FR', 'fr'],
		['pt_BR', 'pt-BR'],
		['pt_PT', 'pt-PT'],
		['nb_NO', 'nb'],
		['zh_CN', 'zh-Hans'],
		['zh_TW', 'zh-Hant'],
	]) {
		assert.equal(catalogueForWordPressLocale(wordPress).tag, tag);
	}
});

test('user admin language wins; absent override falls back to site, then English', () => {
	assert.equal(resolveUiCatalogue('fr_FR', 'en_GB').tag, 'fr');
	assert.equal(resolveUiCatalogue('', 'pt_BR').tag, 'pt-BR');
	assert.equal(resolveUiCatalogue(null, 'xx_XX').tag, 'en');
	assert.equal(resolveUiCatalogue('xx_XX', 'fr_FR').tag, 'en');
});

test('compiles a byte-stable PHP MO and WordPress handle-specific JS Jed JSON', () => {
	withFixture(({ output, result }) => {
		assert.deepEqual(result.translatedLanguages, ['fr']);
		assert.equal(result.assets.length, 2);
		const mo = readFileSync(join(output, 'moda-interact-fr_FR.mo'));
		assert.equal(mo.readUInt32LE(0), 0x950412de);
		assert.equal(mo.readUInt32LE(8), 4);
		const script = JSON.parse(
			readFileSync(
				join(output, 'moda-interact-fr_FR-moda-interact.json'),
				'utf8'
			)
		);
		assert.equal(
			script.locale_data.messages['Save category'][0],
			'Enregistrer la catégorie'
		);
		assert.equal(
			script.locale_data.messages['%d recovery'][1],
			'%d récupérations'
		);
		assert.equal(
			script.locale_data.messages.Overview,
			undefined,
			'PHP-only messages must not leak into JS'
		);
		assert.equal(
			script.locale_data.messages['']['plural-forms'],
			'nplurals=2; plural=(n > 1);'
		);
		assert.ok(mo.includes(Buffer.from('Vue d’ensemble')));
	});
});

test('fails closed for untranslated or corrupt placeholders and strict missing locales', () => {
	const source = readFileSync(
		join(fixtures, 'moda-interact-fr_FR.po'),
		'utf8'
	);
	for (const bad of [
		source.replace('Enregistrer la catégorie', ''),
		source.replace('%d récupérations', '%s récupérations'),
	]) {
		const directory = mkdtempSync(join(tmpdir(), 'moda-i18n-bad-'));
		try {
			copyFileSync(
				join(fixtures, 'moda-interact.pot'),
				join(directory, 'moda-interact.pot')
			);
			writeFileSync(join(directory, 'moda-interact-fr_FR.po'), bad);
			assert.throws(
				() =>
					compileCatalogues({
						languagesDirectory: directory,
						outputDirectory: join(directory, 'output'),
					}),
				/missing translation|placeholder mismatch/
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}
	const strictDirectory = mkdtempSync(join(tmpdir(), 'moda-i18n-strict-'));
	try {
		assert.throws(
			() =>
				compileCatalogues({
					languagesDirectory: fixtures,
					outputDirectory: strictDirectory,
					strict: true,
				}),
			/Missing .* catalogue/
		);
	} finally {
		rmSync(strictDirectory, { recursive: true, force: true });
	}
});

test('extracts no generated bundle when producing the source POT', () => {
	const source = readFileSync(
		resolve(import.meta.dirname, '../../scripts/make-pot.mjs'),
		'utf8'
	);
	assert.match(source, /--include=moda-interact\.php,includes,src/);
	assert.match(source, /--exclude=build,node_modules,vendor,tests/);
	assert.doesNotMatch(source, /--merge=/);
	assert.deepEqual(
		parsePo(readFileSync(join(fixtures, 'moda-interact.pot'), 'utf8'))
			.filter((item) => item.id)
			.map((item) => item.id),
		['Overview', 'Save category', '%d recovery']
	);
});
