import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_LOCALES } from './locales.mjs';
import { originalKey, poFromFile } from './gettext.mjs';

const prefix = 'moda-interact/languages/';
const textDomain = 'moda-interact';

/**
 * Verify that the distributable contains every reviewed translation asset,
 * exactly as compiled from the corresponding local PO sources.
 *
 * @param {Object}                   options                    Release checker options.
 * @param {string[]}                 options.entries            ZIP entry names.
 * @param {(name: string) => Buffer} options.readPackagedAsset  Read an archive entry.
 * @param {string}                   options.languagesDirectory Location of compiled PO/MO/JSON assets.
 */
export function verifyReleaseAssets({
	entries,
	readPackagedAsset,
	languagesDirectory,
}) {
	const required = new Set(
		poFromFile(join(languagesDirectory, `${textDomain}.pot`))
			.filter((entry) => entry.id)
			.map(originalKey)
	);
	assert.ok(required.size > 0, 'translation template has no source messages');

	const expected = [];
	const manifest = [];
	for (const { tag, wordpress } of SUPPORTED_LOCALES) {
		if (tag === 'en') {
			continue;
		}
		const locale = wordpress[0];
		const po = poFromFile(
			join(languagesDirectory, `${textDomain}-${locale}.po`)
		);
		assert.deepEqual(
			new Set(po.filter((entry) => entry.id).map(originalKey)),
			required,
			`${tag}: catalogue keys differ from the release template`
		);
		for (const filename of [
			`${textDomain}-${locale}.mo`,
			`${textDomain}-${locale}-${textDomain}.json`,
		]) {
			expected.push(`${prefix}${filename}`);
		}
		manifest.push({ tag, locale, sourceMessages: required.size });
	}
	assert.equal(
		manifest.length,
		19,
		'release requires 19 translations plus English'
	);
	const available = entries
		.filter((entry) =>
			/^moda-interact\/languages\/moda-interact-[\w-]+\.(?:mo|json)$/.test(
				entry
			)
		)
		.sort();
	assert.deepEqual(
		available,
		expected.sort(),
		'release ZIP must contain exactly the 38 approved translation assets'
	);
	for (const asset of expected) {
		const local = readFileSync(
			join(languagesDirectory, asset.slice(prefix.length))
		);
		const packaged = readPackagedAsset(asset);
		assert.ok(
			Buffer.isBuffer(packaged) && packaged.equals(local),
			`${asset} differs from its compiled source asset`
		);
		if (asset.endsWith('.json')) {
			const data = JSON.parse(packaged.toString('utf8'));
			const locale = asset
				.slice(prefix.length + `${textDomain}-`.length)
				.replace(`-${textDomain}.json`, '');
			assert.equal(data.locale_data?.messages?.['']?.lang, locale);
			assert.equal(data.locale_data?.messages?.['']?.domain, textDomain);
		}
	}
	return {
		languages: 20,
		messages: required.size,
		assets: expected.length,
		manifest,
	};
}
