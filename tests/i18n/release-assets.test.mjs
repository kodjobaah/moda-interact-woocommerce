import assert from 'node:assert/strict';
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// eslint-disable-next-line vitest/no-import-node-test -- This suite runs with node --test.
import { test } from 'node:test';
import { compileCatalogues } from '../../scripts/i18n/compile.mjs';
import { verifyReleaseAssets } from '../../scripts/i18n/release-assets.mjs';

const languagesDirectory = resolve(import.meta.dirname, '../../languages');

function withCompiledRelease(verify) {
	const directory = mkdtempSync(join(tmpdir(), 'moda-woo014-'));
	try {
		for (const filename of readdirSync(languagesDirectory)) {
			if (filename.endsWith('.po') || filename.endsWith('.pot')) {
				copyFileSync(
					join(languagesDirectory, filename),
					join(directory, filename)
				);
			}
		}
		const compiled = compileCatalogues({
			languagesDirectory: directory,
			outputDirectory: directory,
			strict: true,
		});
		const entries = compiled.assets.map(
			(name) => `moda-interact/languages/${name}`
		);
		const readPackagedAsset = (name) =>
			readFileSync(join(directory, name.split('/').at(-1)));
		return verify({ entries, readPackagedAsset, directory });
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test('WOO-014 release manifest covers all 20 languages and source keys', () => {
	withCompiledRelease(({ entries, readPackagedAsset, directory }) => {
		const release = verifyReleaseAssets({
			entries,
			readPackagedAsset,
			languagesDirectory: directory,
		});
		assert.equal(release.languages, 20);
		assert.equal(release.messages, 180);
		assert.equal(release.assets, 38);
		assert.equal(release.manifest.length, 19);
	});
});

test('WOO-014 release rejects a missing language asset', () => {
	withCompiledRelease(({ entries, readPackagedAsset, directory }) => {
		assert.throws(
			() =>
				verifyReleaseAssets({
					entries: entries.filter(
						(name) => !name.endsWith('moda-interact-pt_PT.mo')
					),
					readPackagedAsset,
					languagesDirectory: directory,
				}),
			/38 approved translation assets/
		);
	});
});

test('WOO-014 release rejects stale/mismatched or extra translation assets', () => {
	withCompiledRelease(({ entries, readPackagedAsset, directory }) => {
		const changed = (name) =>
			name.endsWith('moda-interact-zh_TW-moda-interact.json')
				? Buffer.from('{}', 'utf8')
				: readPackagedAsset(name);
		assert.throws(
			() =>
				verifyReleaseAssets({
					entries,
					readPackagedAsset: changed,
					languagesDirectory: directory,
				}),
			/differs from its compiled source asset/
		);
		assert.throws(
			() =>
				verifyReleaseAssets({
					entries: [
						...entries,
						'moda-interact/languages/moda-interact-xx_XX.mo',
					],
					readPackagedAsset,
					languagesDirectory: directory,
				}),
			/38 approved translation assets/
		);
	});
});
