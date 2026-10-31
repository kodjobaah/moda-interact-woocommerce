import assert from 'node:assert/strict';

// A controlled HTTPS stand-in for the Woo-facing transport. This proves the
// WordPress plugin's wiring; it is NOT a substitute for architect-accepted
// API-006/API-007 integration tests against the actual hosted implementations.
const CONSENT_KEYS = [
	'canonicalPhone',
	'decision',
	'disclosure',
	'eventId',
	'occurredAt',
	'schemaVersion',
];
const grantStatus = 'CONFIRMED_GRANTED';
const unknownStatus = 'UNVERIFIED';

export function assertConsentEvent(event) {
	assert.deepEqual(Object.keys(event).sort(), CONSENT_KEYS);
	assert.equal(event.schemaVersion, 'woo.whatsapp-consent.v2');
	assert.match(event.eventId, /^woo-consent-[0-9a-f]{32}$/);
	assert.ok(['GRANT', 'REVOKE'].includes(event.decision));
	assert.match(event.canonicalPhone, /^[1-9][0-9]{1,14}$/);
	assert.match(
		event.occurredAt,
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
	);
	if (event.decision === 'GRANT') {
		assert.deepEqual(Object.keys(event.disclosure ?? {}).sort(), [
			'locale',
			'text',
			'version',
		]);
		assert.match(
			event.disclosure.version,
			/^moda\.woo\.whatsapp-recovery-marketing\.v\d+$/
		);
		assert.ok(event.disclosure.text.length > 0);
	} else {
		assert.equal(event.disclosure, null);
	}
}

export function createConsentApiFixture() {
	let featureEnabled = false;
	let featureReadCount = 0;
	let enabledFeatureReadCount = 0;
	let writeStatus = 200;
	let readStatus = 200;
	let nextRevision = 0;
	const requests = [];
	const statusRequests = [];
	const events = new Map();
	const latestByPhone = new Map();

	function checkInstallation(request) {
		assert.equal(
			request.headers['x-moda-installation-id'],
			'install_wp_fixture'
		);
		assert.equal(
			request.headers.authorization,
			`Bearer ${Buffer.alloc(32, 2).toString('base64url')}`
		);
		assert.equal(
			request.headers.cookie,
			undefined,
			'No shopper cookies may be forwarded to Moda'
		);
	}

	function handleRequest({ url, request, response, bodyBytes, sendJson }) {
		if (
			url.pathname === '/v1/merchant/feature-preferences' &&
			request.method === 'GET'
		) {
			featureReadCount += 1;
			if (!featureEnabled) {
				return false;
			}
			checkInstallation(request);
			enabledFeatureReadCount += 1;
			sendJson(response, 200, {
				schemaVersion: 1,
				revision: 'a'.repeat(64),
				features: [
					{
						id: 'fixture-checkout-recovery',
						key: 'checkout_recovery',
						name: 'Checkout Recovery',
						description: null,
						enabled: true,
						effective: true,
						editable: false,
						required: true,
						planEligible: true,
					},
				],
			});
			return true;
		}
		if (
			url.pathname === '/v1/woocommerce/whatsapp-consent' &&
			request.method === 'POST'
		) {
			checkInstallation(request);
			const event = JSON.parse(bodyBytes.toString('utf8'));
			assertConsentEvent(event);
			requests.push({ event, httpStatus: writeStatus });
			if (writeStatus !== 200) {
				sendJson(response, writeStatus, {
					error: 'fixture_unavailable',
				});
				return true;
			}
			const previous = events.get(event.eventId);
			if (previous) {
				assert.deepEqual(
					event,
					previous,
					'Identical event IDs must preserve their original payload'
				);
			} else {
				nextRevision += 1;
				events.set(event.eventId, event);
				latestByPhone.set(event.canonicalPhone, event);
			}
			sendJson(response, 200, {
				schemaVersion: 'woo.whatsapp-consent.v2',
				status: previous ? 'duplicate' : 'recorded',
				decision: event.decision,
				consentRevision: String(nextRevision),
				decisionSequence: String(nextRevision),
			});
			return true;
		}
		if (
			url.pathname === '/v1/woocommerce/whatsapp-consent/status' &&
			request.method === 'POST'
		) {
			checkInstallation(request);
			assert.equal(url.search, '', 'Proof must never appear in the URL');
			const proof = JSON.parse(bodyBytes.toString('utf8'));
			assert.deepEqual(Object.keys(proof).sort(), [
				'canonicalPhone',
				'grantEventId',
				'schemaVersion',
			]);
			assert.equal(proof.schemaVersion, 'woo.whatsapp-consent-status.v1');
			statusRequests.push(proof);
			if (readStatus !== 200) {
				sendJson(response, readStatus, {
					error: 'fixture_unavailable',
				});
				return true;
			}
			const event = events.get(proof.grantEventId);
			const latest = latestByPhone.get(proof.canonicalPhone);
			const confirmed =
				event?.decision === 'GRANT' &&
				event?.canonicalPhone === proof.canonicalPhone &&
				latest?.decision === 'GRANT' &&
				latest?.eventId === event.eventId;
			sendJson(response, 200, {
				schemaVersion: 'woo.whatsapp-consent-status.v1',
				state: confirmed ? grantStatus : unknownStatus,
			});
			return true;
		}
		return false;
	}

	return {
		handleRequest,
		setFeatureEnabled: (enabled) => {
			featureEnabled = enabled;
		},
		setWriteStatus: (status) => {
			writeStatus = status;
		},
		setReadStatus: (status) => {
			readStatus = status;
		},
		// Counters only: never record installation credentials, checkout HTML or phones.
		getFeatureReadDiagnostics: () => ({
			total: featureReadCount,
			enabled: enabledFeatureReadCount,
		}),
		getRequests: () => [...requests],
		getStatusRequests: () => [...statusRequests],
	};
}
