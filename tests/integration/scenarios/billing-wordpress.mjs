import assert from 'node:assert/strict';

function assertBillingAuthentication(request) {
	assert.equal(
		request.headers['x-moda-installation-id'],
		'install_wp_fixture'
	);
	assert.equal(
		request.headers.authorization,
		`Bearer ${Buffer.alloc(32, 2).toString('base64url')}`
	);
	assert.equal(request.headers.cookie, undefined);
}

function billingPresentationFixture() {
	return {
		schemaVersion: 1,
		experienceState: 'ACTIVE',
		surfaces: {
			usageHistoryAllowed: true,
			purchaseHistoryAllowed: true,
			managePlansAllowed: true,
			cancelSubscriptionAllowed: true,
		},
		currentPlan: {
			merchantPricingPlanId: 'plan_free',
			displayName: 'Free',
			planKind: 'FREE',
			recurringAmountMinor: 0,
			currency: 'USD',
			billingPeriod: 'EVERY_30_DAYS',
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			cancellationEffectiveAt: null,
		},
		pendingPlan: null,
		pendingCancellation: null,
		capacity: {
			paidIncluded: null,
			freeLifetime: {
				granted: 2,
				committed: 0,
				reserved: 0,
				remaining: 2,
			},
			promotional: {
				granted: 0,
				committed: 0,
				reserved: 0,
				remaining: 0,
			},
			purchased: {
				granted: 0,
				committed: 0,
				reserved: 0,
				refunding: 0,
				available: 0,
			},
		},
		topUps: {
			configured: false,
			purchaseEligible: false,
			offers: [],
			latestPurchase: null,
			unresolvedPurchases: [],
		},
	};
}

export function createBillingWordPressFixture() {
	const counts = {
		billingReadCount: 0,
		plansReadCount: 0,
		createCount: 0,
		switchCount: 0,
		cancelCount: 0,
	};

	function handleRequest({ url, request, response, bodyBytes, sendJson }) {
		if (url.pathname === '/v1/billing' && request.method === 'GET') {
			assertBillingAuthentication(request);
			assert.equal(url.search, '');
			counts.billingReadCount += 1;
			sendJson(response, 200, billingPresentationFixture());
			return true;
		}
		if (url.pathname === '/v1/billing/plans' && request.method === 'GET') {
			assertBillingAuthentication(request);
			assert.equal(url.search, '?locale=en-GB');
			counts.plansReadCount += 1;
			sendJson(response, 200, {
				schemaVersion: 1,
				resolvedLocale: 'en-GB',
				plans: [
					{
						merchantPricingPlanId: 'plan_paid',
						displayName: 'Growth',
						planKind: 'PAID_METERED',
						cataloguePosition: 1,
						featured: true,
						localizedDescription: 'Growth plan',
						includedRecoveryCredits: 10,
						allowancePeriod: 'EVERY_30_DAYS',
						billingPeriod: 'EVERY_30_DAYS',
						recurringAmountMinor: 4900,
						currency: 'USD',
						highlights: [],
					},
				],
			});
			return true;
		}
		if (
			url.pathname === '/v1/billing/subscription' &&
			request.method === 'POST'
		) {
			assertBillingAuthentication(request);
			assert.match(
				request.headers['idempotency-key'] ?? '',
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
			);
			assert.deepEqual(Object.keys(JSON.parse(bodyBytes)).sort(), [
				'merchantPricingPlanId',
			]);
			counts.createCount += 1;
			sendJson(response, 202, {
				schemaVersion: 1,
				operationId: 'operation_create',
				kind: 'SUBSCRIPTION_CREATE',
				state: 'AWAITING_CONFIRMATION',
				confirmationUrl: 'https://woocommerce.com/confirm/create',
			});
			return true;
		}
		if (
			url.pathname === '/v1/billing/subscription/switch' &&
			request.method === 'POST'
		) {
			assertBillingAuthentication(request);
			assert.match(
				request.headers['idempotency-key'] ?? '',
				/^[0-9a-f-]{36}$/i
			);
			assert.deepEqual(Object.keys(JSON.parse(bodyBytes)).sort(), [
				'merchantPricingPlanId',
			]);
			counts.switchCount += 1;
			sendJson(response, 202, {
				schemaVersion: 1,
				operationId: 'operation_switch',
				kind: 'PLAN_SWITCH',
				state: 'AWAITING_CONFIRMATION',
				confirmationUrl:
					'https://sandbox.woocommerce.com/confirm/switch',
			});
			return true;
		}
		if (
			url.pathname === '/v1/billing/subscription' &&
			request.method === 'DELETE'
		) {
			assertBillingAuthentication(request);
			assert.match(
				request.headers['idempotency-key'] ?? '',
				/^[0-9a-f-]{36}$/i
			);
			assert.equal(bodyBytes.length, 0);
			counts.cancelCount += 1;
			sendJson(response, 200, {
				schemaVersion: 1,
				operationId: 'operation_cancel',
				kind: 'CANCEL',
				state: 'CONFIRMED',
				confirmationUrl: null,
			});
			return true;
		}
		return false;
	}

	return {
		handleRequest,
		counts: () => ({ ...counts }),
		assertExpectedRequestCounts() {
			assert.deepEqual(Object.values(counts), [1, 1, 1, 1, 1]);
		},
	};
}

export async function assertBillingWordPress({
	siteUrl,
	auth,
	fetchWordPress,
	fixture,
}) {
	const billingRequest = (path, options = {}) =>
		fetchWordPress(`${siteUrl}/wp-json/moda-interact/v1/billing${path}`, {
			...options,
			headers: {
				...(options.headers ?? {}),
				Cookie: `${auth.cookieName}=${auth.cookie}`,
				'X-WP-Nonce': auth.nonce,
			},
		});
	const billingRoutes = [
		{ path: '', method: 'GET' },
		{ path: '/plans', method: 'GET' },
		{ path: '/subscription', method: 'POST' },
		{ path: '/subscription/switch', method: 'POST' },
		{ path: '/subscription/cancel', method: 'POST' },
	];
	const commandBody = {
		'/subscription': {
			merchantPricingPlanId: 'plan_paid',
			actionId: '550e8400-e29b-41d4-a716-446655440001',
		},
		'/subscription/switch': {
			merchantPricingPlanId: 'plan_paid',
			actionId: '550e8400-e29b-41d4-a716-446655440002',
		},
		'/subscription/cancel': {
			actionId: '550e8400-e29b-41d4-a716-446655440003',
		},
	};

	for (const route of billingRoutes) {
		const denied = await fetchWordPress(
			`${siteUrl}/wp-json/moda-interact/v1/billing${route.path}`,
			{ method: route.method }
		);
		assert.ok(
			denied.status === 401 || denied.status === 403,
			`unauthenticated billing ${route.method} ${route.path} must be denied`
		);
		const badNonceResponse = await fetchWordPress(
			`${siteUrl}/wp-json/moda-interact/v1/billing${route.path}`,
			{
				method: route.method,
				headers: {
					Cookie: `${auth.cookieName}=${auth.cookie}`,
					'X-WP-Nonce': 'invalid',
					'content-type': 'application/json',
				},
				...(commandBody[route.path]
					? { body: JSON.stringify(commandBody[route.path]) }
					: {}),
			}
		);
		assert.ok(
			badNonceResponse.status === 401 || badNonceResponse.status === 403,
			`invalid nonce billing ${route.method} ${route.path} must be denied`
		);
	}

	const billingResponse = await billingRequest('');
	assert.equal(billingResponse.status, 200);
	assert.match(
		billingResponse.headers.get('cache-control') ?? '',
		/\bprivate\b/i
	);
	assert.match(
		billingResponse.headers.get('cache-control') ?? '',
		/\bno-store\b/i
	);
	assert.equal((await billingResponse.json()).currentPlan.planKind, 'FREE');

	const plansResponse = await billingRequest('/plans');
	assert.equal(plansResponse.status, 200);
	assert.equal((await plansResponse.json()).resolvedLocale, 'en-GB');

	for (const path of ['/subscription', '/subscription/switch']) {
		const response = await billingRequest(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(commandBody[path]),
		});
		assert.equal(response.status, 200);
		const result = await response.json();
		assert.deepEqual(Object.keys(result).sort(), [
			'confirmationUrl',
			'operationId',
			'schemaVersion',
			'state',
		]);
		assert.equal(result.state, 'AWAITING_CONFIRMATION');
	}

	const cancellationResponse = await billingRequest('/subscription/cancel', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(commandBody['/subscription/cancel']),
	});
	assert.equal(cancellationResponse.status, 200);
	assert.deepEqual(await cancellationResponse.json(), {
		schemaVersion: 1,
		operationId: 'operation_cancel',
		state: 'CONFIRMED',
		confirmationUrl: null,
	});
	fixture.assertExpectedBillingRequestCounts();
}
