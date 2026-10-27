import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac } from 'node:crypto';
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

test('woo.shop-brand.v1 HTTPS fixture validates installation auth, immutable event identity, retries and removals', async () => {
	const siteUrl = 'http://localhost:8888';
	const attemptId = '550e8400-e29b-41d4-a716-446655440000';
	const bootstrapSecret = Buffer.alloc(32, 7).toString('base64url');
	const fixture = createWordPressApiFixture({
		getSiteUrl: () => siteUrl,
		fetchWordPress: async (url) => {
			const nonce = url.searchParams.get('nonce');
			return {
				status: 200,
				headers: { get: () => 'application/json' },
				json: async () => ({
					attemptId,
					nonce,
					proof: createHmac('sha256', Buffer.from(bootstrapSecret, 'base64url'))
						.update(`moda-interact-connect-v1\n${attemptId}\n${nonce}\n${siteUrl}`)
						.digest('base64url'),
				}),
			};
		},
	});
	const connected = await dispatch(fixture, request(
		'POST', '/v1/woocommerce/installations/connect',
		JSON.stringify({ attemptId, bootstrapSecret, siteUrl }),
		{ headers: { authorization: undefined } }
	));
	assert.equal(connected.status, 201);
	const canonical = {
		brandName: 'Example Store',
		logo: {
			url: 'https://cdn.example.test/logo.png', attachmentId: 41,
			altText: 'Example logo', width: 1200, height: 400,
		},
		siteIcon: null,
		coverImage: null,
	};
	const event = {
		schemaVersion: 'woo.shop-brand.v1',
		eventId: `woo-brand-${createHash('sha256')
			.update(`install_wp_fixture\0${JSON.stringify(canonical)}`).digest('hex')}`,
		observedAt: '2026-10-27T12:00:00.000000Z',
		...canonical,
	};
	const post = (payload, headers = {}) => request(
		'POST', '/v1/woocommerce/shop-brand', JSON.stringify(payload),
		{ headers: { authorization: `Bearer ${connected.body.credential}`, 'content-type': 'application/json', ...headers } }
	);
	assert.deepEqual(await dispatch(fixture, post(event)), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		body: { status: 'updated' },
	});
	assert.equal((await dispatch(fixture, post(event))).body.status, 'unchanged');
	fixture.setShopBrandStatus(503);
	assert.equal((await dispatch(fixture, post(event))).status, 503);
	fixture.setShopBrandStatus(429);
	assert.equal((await dispatch(fixture, post(event))).status, 429);
	fixture.setShopBrandStatus(400);
	assert.equal((await dispatch(fixture, post(event))).status, 400);
	fixture.setShopBrandStatus(200);
	assert.equal(fixture.getShopBrandRequests().length, 5);

	await assert.rejects(
		dispatch(fixture, post(event, { authorization: 'Bearer wrong-installation' })),
		/Expected values to be strictly equal/
	);
	await assert.rejects(
		dispatch(fixture, post({ ...event, shopId: 'untrusted-shop' })),
		/Expected values to be strictly deep-equal/
	);
	await assert.rejects(
		dispatch(fixture, post({ ...event, logo: { ...canonical.logo, url: 'http://not-secure.test/logo.png' } })),
		/Expected values to be strictly equal/
	);
	const removed = { ...canonical, logo: null };
	const eventRemoved = {
		...event,
		...removed,
		eventId: `woo-brand-${createHash('sha256')
			.update(`install_wp_fixture\0${JSON.stringify(removed)}`).digest('hex')}`,
	};
	assert.equal((await dispatch(fixture, post(eventRemoved))).body.status, 'updated');
	assert.equal(fixture.getShopBrandRequests().at(-1).event.logo, null);
});
