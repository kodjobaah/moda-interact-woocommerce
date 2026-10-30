import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertConsentEvent,
	createConsentApiFixture,
} from './consent-api-fixture.mjs';
import { consentExtensionResult } from './scenarios/checkout-consent-wordpress.mjs';

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
