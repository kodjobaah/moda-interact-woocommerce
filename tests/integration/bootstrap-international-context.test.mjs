/* eslint vitest/no-import-node-test: "off" */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootstrapInternationalContext } from './bootstrap-international-context.mjs';

test('retains the original bootstrap international context before sync', () => {
	assert.deepEqual(bootstrapInternationalContext(null), {
		storeLocale: 'pt_BR',
		languageTag: null,
		timeZone: 'Europe/Lisbon',
		countryCode: 'PT',
	});
});

test('omits the versioned write envelope from the bootstrap read model', () => {
	const saved = {
		schemaVersion: 1,
		storeLocale: 'en_GB',
		languageTag: 'en-GB',
		timeZone: 'Europe/London',
		countryCode: 'GB',
	};
	assert.deepEqual(bootstrapInternationalContext(saved), {
		storeLocale: 'en_GB',
		languageTag: 'en-GB',
		timeZone: 'Europe/London',
		countryCode: 'GB',
	});
	assert.equal(
		saved.schemaVersion,
		1,
		'the persisted snapshot remains unchanged'
	);
});

test('retains nullable language values without adding contract fields', () => {
	const context = bootstrapInternationalContext({
		schemaVersion: 1,
		storeLocale: 'pt_BR',
		languageTag: null,
		timeZone: 'America/Sao_Paulo',
		countryCode: 'BR',
	});
	assert.deepEqual(Object.keys(context).sort(), [
		'countryCode',
		'languageTag',
		'storeLocale',
		'timeZone',
	]);
	assert.equal(context.languageTag, null);
});
