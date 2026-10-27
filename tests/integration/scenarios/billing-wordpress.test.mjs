import assert from 'node:assert/strict';
import test from 'node:test';
import { createBillingWordPressFixture } from './billing-wordpress.mjs';

function fixtureResponse() {
	let status;
	let headers = {};
	let body = '';
	return {
		response: {
			writeHead(nextStatus, nextHeaders) {
				status = nextStatus;
				headers = nextHeaders;
			},
			end(nextBody) {
				body = nextBody;
			},
		},
		toFetchResponse() {
			return {
				status,
				headers: { get: (name) => headers[name] ?? null },
				json: async () => JSON.parse(body),
			};
		},
	};
}

test('billing HTTPS fixture serves authenticated routes and counts each request once', () => {
	const fixture = createBillingWordPressFixture();
	const requests = [
		{ path: '/v1/billing', method: 'GET', search: '', body: '' },
		{
			path: '/v1/billing/plans',
			method: 'GET',
			search: '?locale=en-GB',
			body: '',
		},
		{
			path: '/v1/billing/subscription',
			method: 'POST',
			search: '',
			body: JSON.stringify({ merchantPricingPlanId: 'plan_paid' }),
		},
		{
			path: '/v1/billing/subscription/switch',
			method: 'POST',
			search: '',
			body: JSON.stringify({ merchantPricingPlanId: 'plan_paid' }),
		},
		{
			path: '/v1/billing/subscription',
			method: 'DELETE',
			search: '',
			body: '',
		},
	];
	const statuses = [];

	for (const item of requests) {
		const output = fixtureResponse();
		const handled = fixture.handleRequest({
			url: new URL(
				`${item.path}${item.search}`,
				'https://fixture.invalid'
			),
			request: {
				method: item.method,
				headers: {
					'x-moda-installation-id': 'install_wp_fixture',
					authorization: `Bearer ${Buffer.alloc(32, 2).toString('base64url')}`,
					'idempotency-key': '550e8400-e29b-41d4-a716-446655440000',
				},
			},
			response: output.response,
			bodyBytes: Buffer.from(item.body),
			sendJson(response, status, body) {
				response.writeHead(status, {
					'content-type': 'application/json',
				});
				response.end(JSON.stringify(body));
			},
		});
		assert.equal(handled, true);
		statuses.push(output.toFetchResponse().status);
	}

	assert.deepEqual(statuses, [200, 200, 202, 202, 200]);
	fixture.assertExpectedRequestCounts();
});

test('billing HTTPS fixture rejects invalid authentication and unrelated routes', () => {
	const fixture = createBillingWordPressFixture();
	const output = fixtureResponse();
	const input = {
		url: new URL('/v1/billing', 'https://fixture.invalid'),
		request: { method: 'GET', headers: {} },
		response: output.response,
		bodyBytes: Buffer.alloc(0),
		sendJson() {},
	};

	assert.throws(() => fixture.handleRequest(input), assert.AssertionError);
	assert.equal(
		fixture.handleRequest({
			...input,
			url: new URL('/v1/unrelated', 'https://fixture.invalid'),
		}),
		false
	);
});
