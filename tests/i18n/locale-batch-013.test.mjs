import assert from 'node:assert/strict';
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
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
const plural = 'nplurals=1; plural=0;';
const batch = [
	{
		tag: 'ja',
		locale: 'ja',
		php: 'このセクションはまだ WooCommerce では利用できません。',
		save: 'カテゴリを保存',
		billing: '請求',
	},
	{
		tag: 'ko',
		locale: 'ko_KR',
		php: '이 섹션은 아직 WooCommerce에서 사용할 수 없습니다.',
		save: '카테고리 저장',
		billing: '청구',
	},
	{
		tag: 'th',
		locale: 'th',
		php: 'ส่วนนี้ยังไม่พร้อมใช้งานสำหรับ WooCommerce',
		save: 'บันทึกหมวดหมู่',
		billing: 'การเรียกเก็บเงิน',
	},
	{
		tag: 'zh-Hans',
		locale: 'zh_CN',
		php: '此版块暂不支持 WooCommerce。',
		save: '保存类别',
		billing: '账单',
	},
	{
		tag: 'zh-Hant',
		locale: 'zh_TW',
		php: '此區段尚未支援 WooCommerce。',
		save: '儲存類別',
		billing: '帳務',
	},
];

function withTemporaryDirectory(callback) {
	const directory = mkdtempSync(join(tmpdir(), 'moda-woo013-'));
	try {
		return callback(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function moTranslation(buffer, key) {
	assert.equal(buffer.readUInt32LE(0), 0x950412de);
	const count = buffer.readUInt32LE(8);
	const sourceIndex = buffer.readUInt32LE(12);
	const translatedIndex = buffer.readUInt32LE(16);
	for (let index = 0; index < count; index++) {
		const idLength = buffer.readUInt32LE(sourceIndex + index * 8);
		const idOffset = buffer.readUInt32LE(sourceIndex + index * 8 + 4);
		if (buffer.toString('utf8', idOffset, idOffset + idLength) !== key) {
			continue;
		}
		const valueLength = buffer.readUInt32LE(translatedIndex + index * 8);
		const valueOffset = buffer.readUInt32LE(
			translatedIndex + index * 8 + 4
		);
		return buffer.toString('utf8', valueOffset, valueOffset + valueLength);
	}
	return undefined;
}

test('WOO-013 provides all 195 messages with one-form plural metadata', () => {
	assert.equal(sourceKeys.size, 195);
	const unchangedNames = new Set([
		'Moda Interact',
		'WooCommerce',
		'Free',
		'%1$s: %2$s',
	]);
	for (const { locale } of batch) {
		const entries = poFromFile(
			join(languagesDirectory, `moda-interact-${locale}.po`)
		);
			assert.equal(entries.length, 196, locale);
		assert.deepEqual(
			new Set(entries.filter((entry) => entry.id).map(originalKey)),
			sourceKeys,
			locale
		);
		assert.ok(
			entries[0].translations[0].includes(`Plural-Forms: ${plural}`),
			locale
		);
		for (const entry of entries.filter((item) => item.id)) {
			assert.ok(entry.translations[0], `${locale}: ${entry.id}`);
			assert.ok(!entry.fuzzy, `${locale}: fuzzy entry`);
			assert.equal(entry.context, undefined, `${locale}: new namespace`);
			assert.ok(
				unchangedNames.has(entry.id) ||
					entry.id !== entry.translations[0],
				`${locale}: English fallback: ${entry.id}`
			);
		}
	}
});

test('WOO-013 produces native gettext and WordPress script assets', () => {
	withTemporaryDirectory((outputDirectory) => {
		const result = compileCatalogues({
			languagesDirectory,
			outputDirectory,
			strict: true,
		});
			assert.equal(result.requiredMessages, 195);
		assert.equal(result.translatedLanguages.length, 19);
		assert.equal(result.assets.length, 38);
		for (const { tag, locale, php, save, billing } of batch) {
			assert.ok(result.translatedLanguages.includes(tag));
			const mo = readFileSync(
				join(outputDirectory, `moda-interact-${locale}.mo`)
			);
			assert.equal(
				moTranslation(
					mo,
					'This section is not yet available for WooCommerce.'
				),
				php
			);
			assert.equal(moTranslation(mo, 'Save category'), save);
			assert.ok(
				moTranslation(mo, '').includes(`Plural-Forms: ${plural}`)
			);
			const script = JSON.parse(
				readFileSync(
					join(
						outputDirectory,
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
				'PHP-only messages must not appear in the JS catalogue'
			);
		}
	});
});

test('WOO-013 rejects missing messages, blanks and printf substitutions', () => {
	for (const { locale, save } of batch) {
		for (const defect of ['missing-entry', 'blank', 'placeholder']) {
			withTemporaryDirectory((directory) => {
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
							outputDirectory: join(directory, 'compiled'),
						}),
					/missing source key|missing translation|placeholder mismatch/
				);
			});
		}
	}
});

test('WOO-013 maps the five administrator languages and separates Chinese scripts', () => {
	for (const { tag, locale } of batch) {
		assert.equal(catalogueForWordPressLocale(locale).tag, tag);
		assert.equal(resolveUiCatalogue(locale, 'en_GB').tag, tag);
	}
	assert.equal(resolveUiCatalogue('xx_XX', 'zh_TW').tag, 'en');
	const simplified = new Map(
		poFromFile(join(languagesDirectory, 'moda-interact-zh_CN.po'))
			.filter((entry) => entry.id)
			.map(({ id, translations }) => [id, translations[0]])
	);
	const traditional = new Map(
		poFromFile(join(languagesDirectory, 'moda-interact-zh_TW.po'))
			.filter((entry) => entry.id)
			.map(({ id, translations }) => [id, translations[0]])
	);
	for (const key of [
		'Billing',
		'Save category',
		'Store category',
		'Support',
		'Cancel subscription',
		'Recovery settings',
		'This section is not yet available for WooCommerce.',
	]) {
		assert.notEqual(simplified.get(key), traditional.get(key), key);
	}
});

test('WOO-013 strict verification fails if any final language catalogue disappears', () => {
	withTemporaryDirectory((directory) => {
		for (const file of readdirSync(languagesDirectory)) {
			if (file.endsWith('.po') || file === 'moda-interact.pot') {
				copyFileSync(
					join(languagesDirectory, file),
					join(directory, file)
				);
			}
		}
		rmSync(join(directory, 'moda-interact-zh_TW.po'));
		assert.throws(
			() =>
				compileCatalogues({
					languagesDirectory: directory,
					outputDirectory: join(directory, 'compiled'),
					strict: true,
				}),
			/Missing zh-Hant catalogue/
		);
	});
});
