import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertConsentEvent,
	createConsentApiFixture,
} from './consent-api-fixture.mjs';
import {
	checkPageBody,
	classicCheckoutProbe,
	assertCartContainsProduct,
	bootstrapClassicCart,
	consentExtensionResult,
} from './scenarios/checkout-consent-wordpress.mjs';
import { session } from './scenarios/checkout-wordpress.mjs';

// Published Shared 2.5.0 accepted UK identity vector.
const phone = '447400123456';
const grant = {
	schemaVersion: 'woo.whatsapp-consent.v2',
	eventId: `woo-consent-${'a'.repeat(32)}`,
	decision: 'GRANT',
	canonicalPhone: phone,
	occurredAt: '2026-10-27T12:00:00.000Z',
	disclosure: {
		version: 'moda.woo.whatsapp-recovery-marketing.v3',
		locale: 'en-GB',
		text: 'Send me WhatsApp shopping updates, reminders and offers.',
	},
};

async function dispatch(fixture, path, payload, method = 'POST') {
	let status;
	let result;
	const handled = await fixture.handleRequest({
		url: new URL(path, 'https://host.docker.internal'),
		request: {
			method,
			headers: {
				'x-moda-installation-id': 'install_wp_fixture',
				authorization: `Bearer ${Buffer.alloc(32, 2).toString('base64url')}`,
			},
		},
		response: {},
		bodyBytes: Buffer.from(JSON.stringify(payload)),
		sendJson: (_response, code, body) => {
			status = code;
			result = body;
		},
	});
	return { handled, status, result };
}

test('fixture accepts exactly the six v2 fields and rejects the v1 wire format', () => {
	assert.doesNotThrow(() => assertConsentEvent(grant));
	assert.throws(
		() => assertConsentEvent({ ...grant, checkoutKey: 'forbidden' }),
		/Expected values to be strictly deep-equal/
	);
	assert.throws(
		() =>
			assertConsentEvent({
				...grant,
				schemaVersion: 'woo.whatsapp-consent.v1',
			}),
		/Expected values to be strictly equal/
	);
});

test('feature read diagnostics contain only bounded counters', async () => {
	const fixture = createConsentApiFixture();
	assert.deepEqual(fixture.getFeatureReadDiagnostics(), {
		total: 0,
		enabled: 0,
	});
	let response = await dispatch(
		fixture,
		'/v1/merchant/feature-preferences',
		null,
		'GET'
	);
	assert.equal(response.handled, false);
	fixture.setFeatureEnabled(true);
	response = await dispatch(
		fixture,
		'/v1/merchant/feature-preferences',
		null,
		'GET'
	);
	assert.equal(response.status, 200);
	assert.deepEqual(fixture.getFeatureReadDiagnostics(), {
		total: 2,
		enabled: 1,
	});
});

test('HTTPS fixture links an authenticated write ACK to a protected proof read and REVOKE', async () => {
	const fixture = createConsentApiFixture();
	const writePath = '/v1/woocommerce/whatsapp-consent';
	const statusPath = `${writePath}/status`;
	let response = await dispatch(fixture, writePath, grant);
	assert.equal(response.handled, true);
	assert.equal(response.status, 200);
	assert.equal(response.result.status, 'recorded');
	response = await dispatch(fixture, writePath, grant);
	assert.equal(response.result.status, 'duplicate');
	const proof = {
		schemaVersion: 'woo.whatsapp-consent-status.v1',
		canonicalPhone: phone,
		grantEventId: grant.eventId,
	};
	response = await dispatch(fixture, statusPath, proof);
	assert.equal(response.result.state, 'CONFIRMED_GRANTED');
	response = await dispatch(fixture, statusPath, {
		...proof,
		grantEventId: `woo-consent-${'b'.repeat(32)}`,
	});
	assert.equal(response.result.state, 'UNVERIFIED');
	const revoke = {
		...grant,
		eventId: `woo-consent-${'c'.repeat(32)}`,
		decision: 'REVOKE',
		disclosure: null,
	};
	response = await dispatch(fixture, writePath, revoke);
	assert.equal(response.result.decision, 'REVOKE');
	response = await dispatch(fixture, statusPath, proof);
	assert.equal(response.result.state, 'UNVERIFIED');
	fixture.setWriteStatus(503);
	response = await dispatch(fixture, writePath, {
		...grant,
		eventId: `woo-consent-${'d'.repeat(32)}`,
	});
	assert.equal(response.status, 503);
	fixture.setReadStatus(503);
	response = await dispatch(fixture, statusPath, proof);
	assert.equal(response.status, 503);
});

test('real CartSchema extension assertions reject missing request-local metadata', () => {
	const body = {
		extensions: {
			'moda-interact-consent': {
				requestId: 'live-123',
				status: 'checked',
				confirmed: false,
				reason: 'consent_proof_missing',
			},
		},
	};
	assert.equal(consentExtensionResult(body, 'live-123').confirmed, false);
	assert.throws(() => consentExtensionResult(body, 'stale-123'));
	assert.throws(() => consentExtensionResult({ extensions: {} }, 'live-123'));
});

test('checkout HTML assertion failures redact full document and nonce data', () => {
	const secret = 'wp_nonce_should_never_be_printed';
	const html = `<html><body data-secret="${secret}"></body></html>`;
	assert.throws(
		() => checkPageBody(html, 'blocks', { total: 1, enabled: 1 }),
		(error) =>
			error.message.includes('featureReads') &&
			!error.message.includes(secret) &&
			!error.message.includes('<html>')
	);
});


test('Classic test requires the exact persisted session cart before evaluating consent UI', () => {
	const item = { id: 42, quantity: 1 };
	assert.doesNotThrow(() =>
		assertCartContainsProduct({ items: [item] }, 42)
	);
	assert.throws(() => assertCartContainsProduct({ items: [] }, 42));
	assert.throws(() =>
		assertCartContainsProduct({ items: [{ id: 99, quantity: 1 }] }, 42)
	);
	assert.throws(() =>
		assertCartContainsProduct({ items: [{ id: 42, quantity: 0 }] }, 42)
	);
});

test('Classic missing-form diagnostics are bounded and never leak checkout HTML', () => {
	const secret = 'sensitive_nonce_not_for_log';
	const html = `<body class="woocommerce-checkout"><script data-secret="${secret}"></script></body>`;
	assert.throws(
		() => checkPageBody(html, 'classic', { total: 1, enabled: 1 }),
		(error) =>
			error.message.includes('Classic shortcode must render') &&
			error.message.includes('hasClassicCheckoutForm') &&
			!error.message.includes(secret)
	);
});

test(
	'Classic checkout bootstrap carries its Woo session cookie into the Store API',
	async () => {
		const requests = [];
		const browser = session(
			'http://localhost:8888',
			'',
			async (url, options) => {
				requests.push({
					url: new URL(url),
					cookie: new Headers(options.headers).get('cookie'),
				});
				if (new URL(url).searchParams.get('add-to-cart') === '42') {
					return new Response('', {
						status: 302,
						headers: {
							location: '/cart/',
							'set-cookie':
								'wp_woocommerce_session_test=test-value; Path=/; HttpOnly',
						},
					});
				}
				if (new URL(url).pathname === '/cart/') {
					return new Response('Cart', { status: 200 });
				}
				return new Response(
					JSON.stringify({ items: [{ id: 42, quantity: 1 }] }),
					{ status: 200 }
				);
			}
		);
		await bootstrapClassicCart(browser, 42);
		assert.deepEqual(
			requests.map(({ url }) => `${url.pathname}${url.search}`),
			['/?add-to-cart=42', '/cart/', '/wp-json/wc/store/v1/cart']
		);
		assert.equal(
			requests[2].cookie,
			'wp_woocommerce_session_test=test-value'
		);
	}
);

test(
	'Classic bootstrap rejects an empty cart after successful frontend response',
	async () => {
		let count = 0;
		const client = {
			async request() {
				count += 1;
				return count === 1
					? new Response('', { status: 200 })
					: new Response(JSON.stringify({ items: [] }), {
							status: 200,
						});
			},
		};
		await assert.rejects(
			bootstrapClassicCart(client, 42),
			/exact fixture product/
		);
	}
);


test('test-only Classic PHP probe reports cart and shortcode state without leaking HTML', () => {
	const privateValue = 'nonces_and_customer_secrets_must_not_leak';
	const payload = {
		phpCartLoaded: true,
		phpCartCount: 0,
		hasClassicShortcode: true,
		comingSoonEnabled: false,
		shortcodeRegistered: true,
		postContentFilterReached: true,
		shortcodeCallbackReached: true,
		shortcodeOutputProduced: true,
		shortcodeEntered: true,
		beforeFormHookEntered: false,
		secret: privateValue,
	};
	const html = `<body class="woocommerce-checkout" data-secret="${privateValue}">
<!-- MODA_ARCH046_CONSENT_PROBE ${JSON.stringify(payload)} -->
</body>`;
	assert.deepEqual(classicCheckoutProbe(html), {
		probePresent: true,
		phpCartLoaded: true,
		phpCartCount: 0,
		hasClassicShortcode: true,
		comingSoonEnabled: false,
		shortcodeRegistered: true,
		postContentFilterReached: true,
		shortcodeCallbackReached: true,
		shortcodeOutputProduced: true,
		shortcodeEntered: true,
		beforeFormHookEntered: false,
	});
	assert.throws(
		() => checkPageBody(html, 'classic', { total: 1, enabled: 1 }),
		(error) =>
			error.message.includes('"phpCartCount":0') &&
			error.message.includes('"shortcodeEntered":true') &&
			!error.message.includes(privateValue) &&
			!error.message.includes('<body')
	);
	assert.equal(classicCheckoutProbe('<html></html>').probePresent, false);
});


test('Classic probe distinguishes disabled checkout shortcode registration from missing post content', () => {
	const html = `<!-- MODA_ARCH046_CONSENT_PROBE ${JSON.stringify({
		phpCartLoaded: true,
		phpCartCount: 1,
		hasClassicShortcode: true,
		comingSoonEnabled: false,
		shortcodeRegistered: true,
		postContentFilterReached: false,
		shortcodeCallbackReached: false,
		shortcodeOutputProduced: false,
		shortcodeEntered: false,
		beforeFormHookEntered: false,
	})} -->`;
	assert.deepEqual(classicCheckoutProbe(html), {
		probePresent: true,
		phpCartLoaded: true,
		phpCartCount: 1,
		hasClassicShortcode: true,
		comingSoonEnabled: false,
		shortcodeRegistered: true,
		postContentFilterReached: false,
		shortcodeCallbackReached: false,
		shortcodeOutputProduced: false,
		shortcodeEntered: false,
		beforeFormHookEntered: false,
	});
});
