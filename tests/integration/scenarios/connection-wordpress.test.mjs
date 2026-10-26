import assert from 'node:assert/strict';
import test from 'node:test';
import { assertConnectionEnvironmentWordPress } from './connection-wordpress.mjs';

test('connection resilience checks TLS, site identity, and persisted credentials in order', async () => {
	const events = [];
	const responses = [
		{ json: async () => ({ status: 'REMOTE_UNAVAILABLE' }) },
		{
			status: 200,
			headers: { get: () => null },
			json: async () => ({ status: 'SITE_URL_CHANGED' }),
		},
	];

	await assertConnectionEnvironmentWordPress({
		request: async (_path, options) => {
			events.push(['request', options]);
			return responses.shift();
		},
		apiOrigin: 'https://fixture.example.test',
		tlsFailureUrl: 'https://127.0.0.1',
		setApiBaseUrl: async (url) => events.push(['api-url', url]),
		setWpHomeOverride: async () => events.push(['site-url', 'override']),
		restoreWpHomeAndSiteUrl: async () =>
			events.push(['site-url', 'restore']),
		restartPlugin: async () => events.push(['plugin', 'restart']),
		readStoredConnection: async () => {
			events.push(['connection', 'read']);
			return ['install_wp_fixture', 2];
		},
	});

	assert.deepEqual(events, [
		['api-url', 'https://127.0.0.1'],
		['request', undefined],
		['api-url', 'https://fixture.example.test'],
		['site-url', 'override'],
		['request', { redirect: 'manual' }],
		['site-url', 'restore'],
		['plugin', 'restart'],
		['connection', 'read'],
	]);
});
