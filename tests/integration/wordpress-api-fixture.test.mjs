import assert from 'node:assert/strict';
import test from 'node:test';
import { createWordPressApiFixture } from './wordpress-api-fixture.mjs';

function responseRecorder() {
	let status;
	let headers = {};
	let body = '';
	return {
		response: {
			writeHead(nextStatus, nextHeaders = {}) {
				status = nextStatus;
				headers = nextHeaders;
			},
			end(nextBody = '') {
				body = nextBody;
			},
		},
		read() {
			return {
				status,
				headers,
				body: body ? JSON.parse(body) : null,
			};
		},
	};
}

function request(method, path, body = '', options = {}) {
	return {
		url: new URL(path, 'https://fixture.invalid'),
		request: {
			method,
			headers: {
				'x-moda-installation-id': 'install_wp_fixture',
				authorization: `Bearer ${Buffer.alloc(32, 2).toString('base64url')}`,
				...options.headers,
			},
		},
		bodyBytes: Buffer.from(body),
	};
}

function dispatch(fixture, input) {
	const recorded = responseRecorder();
	const handled = fixture.handleRequest({
		...input,
		response: recorded.response,
		async sendJson(response, status, body) {
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(body));
		},
	});
	return Promise.resolve(handled).then(() => recorded.read());
}

test('store context retries once and category selection checks generation', async () => {
	const fixture = createWordPressApiFixture({
		fetchWordPress: async () => {
			throw new Error('Challenge callback was not expected');
		},
		getSiteUrl: () => 'http://localhost:8888',
	});
	const snapshot = {
		countryCode: 'GB',
		languageTag: 'en-GB',
		schemaVersion: 1,
		storeLocale: 'en_GB',
		timeZone: 'Europe/London',
	};

	const firstSync = await dispatch(
		fixture,
		request('PUT', '/v1/merchant/store-context', JSON.stringify(snapshot))
	);
	assert.equal(firstSync.status, 503);
	const secondSync = await dispatch(
		fixture,
		request('PUT', '/v1/merchant/store-context', JSON.stringify(snapshot))
	);
	assert.equal(secondSync.status, 204);
	assert.equal(fixture.getState().contextSyncAttempts, 2);
	assert.deepEqual(fixture.getState().savedContext, snapshot);

	const conflict = await dispatch(
		fixture,
		request(
			'POST',
			'/v1/merchant/store-category',
			JSON.stringify({
				categoryId: 'fashion',
				expectedPendingSelectionGeneration: 9,
				schemaVersion: 1,
				selectedMappingIds: ['clothing'],
			})
		)
	);
	assert.equal(conflict.status, 409);
	const selected = await dispatch(
		fixture,
		request(
			'POST',
			'/v1/merchant/store-category',
			JSON.stringify({
				categoryId: 'fashion',
				expectedPendingSelectionGeneration: 0,
				schemaVersion: 1,
				selectedMappingIds: ['clothing'],
			})
		)
	);
	assert.equal(selected.status, 200);
	assert.equal(fixture.getState().categorySelections, 1);
	assert.equal(fixture.getState().categoryGeneration, 1);
});

test('bootstrap fixture returns bounded errors and recovers after invalid responses', async () => {
	const fixture = createWordPressApiFixture({
		fetchWordPress: async () => {
			throw new Error('Challenge callback was not expected');
		},
		getSiteUrl: () => 'http://localhost:8888',
	});
	const input = request('GET', '/v1/merchant/bootstrap');
	const results = [];
	for (let index = 0; index < 5; index += 1) {
		results.push(await dispatch(fixture, input));
	}
	assert.deepEqual(
		results.map((result) => result.status),
		[200, 401, 500, 200, 200]
	);
	assert.equal(results[0].body.schemaVersion, 1);
	assert.equal(results[3].body.schemaVersion, 999);
	assert.equal(results[4].body.schemaVersion, 1);
	assert.equal(fixture.getState().contextSyncAttempts, 0);
});
