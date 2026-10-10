import assert from 'node:assert/strict';
import {
	cpSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// eslint-disable-next-line vitest/no-import-node-test -- This suite runs with node --test.
import { test } from 'node:test';
import {
	sourceMessages,
	verifyTranslationSources,
} from '../../scripts/i18n/verify-source.mjs';

const repository = resolve(import.meta.dirname, '../..');

test('WOO-014 source template covers all current PHP and React literals', () => {
	assert.equal(verifyTranslationSources().sourceMessages, 169);
});

test('WOO-014 recognizes new literal labels but rejects unreviewed dynamic calls', () => {
	assert.deepEqual(
		sourceMessages("__('A new notice', 'moda-interact')", 'example.js'),
		['A new notice']
	);
	assert.throws(
		() => sourceMessages("__(dynamicValue, 'moda-interact')", 'example.js'),
		/unsupported gettext call/
	);
});

test('WOO-014 release gate fails when a new UI button lacks a POT entry', () => {
	const directory = mkdtempSync(join(tmpdir(), 'moda-woo014-source-'));
	try {
		cpSync(join(repository, 'src'), join(directory, 'src'), {
			recursive: true,
		});
		cpSync(join(repository, 'includes'), join(directory, 'includes'), {
			recursive: true,
		});
		mkdirSync(join(directory, 'languages'));
		cpSync(
			join(repository, 'languages/moda-interact.pot'),
			join(directory, 'languages/moda-interact.pot')
		);
		cpSync(
			join(repository, 'moda-interact.php'),
			join(directory, 'moda-interact.php')
		);
		const entry = join(directory, 'src/page.js');
		writeFileSync(
			entry,
			`${readFileSync(entry, 'utf8')}\n__('New translation-required button', 'moda-interact');\n`
		);
		assert.throws(
			() => verifyTranslationSources({ root: directory }),
			/POT differs from PHP\/React gettext literals/
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
