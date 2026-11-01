import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const source = readFileSync(
	join(repo, 'assets/js/checkout-consent-blocks-status.js'),
	'utf8'
);

function fixture({
	phone = '+447400123456',
	granted = false,
	failWrite = false,
	failStatus = false,
	writeDelay = 0,
	ackDelay = 0,
	ackEphemeral = false,
	failWriteReason = 'store_api_expected_phone_unparseable',
	failTransport = false,
	debugEnabled = false,
	noChoiceAck = false,
	fastTimeout = false,
} = {}) {
	const cart = { billingAddress: { country: 'GB', phone }, extensions: {} };
	const writes = [];
	const events = {};
	const subscriptions = [];
	const messages = [];
	const input = {
		checked: false,
		disabled: false,
		setAttribute() {},
		matches: (selector) => selector === 'input[data-moda-consent-control="1"]',
		closest: () => null,
	};
	const document = {
		readyState: 'complete',
		documentElement: {},
		querySelector: () => input,
		addEventListener: (name, callback) => (events[name] = callback),
	};
	const win = {
		document,
		modaWooCheckoutConsentConfig: { optIn: 'Consent text' },
		sessionStorage: { getItem: () => debugEnabled ? '1' : null },
		MutationObserver: class { observe() {} },
		setTimeout(callback, ms) { return setTimeout(callback, ms === 450 ? 0 : (ms === 4000 && fastTimeout ? 15 : ms)); },
		clearTimeout,
		wp: { data: {
			select: () => ({ getCartData: () => cart }),
			subscribe: (callback) => {
				subscriptions.push(callback);
				return () => {
					const index = subscriptions.indexOf(callback);
					if (index !== -1) subscriptions.splice(index, 1);
				};
			},
		} },
		wc: { blocksCheckout: {
			extensionCartUpdate: async ({ namespace, overwriteDirtyCustomerData, data }) => {
				assert.equal(namespace, 'moda-interact-consent');
				assert.equal(overwriteDirtyCustomerData, false);
				writes.push(data);
				if (data.action === 'choice' && failTransport) {
					const error = new Error('Store API rejected consent with HTTP 503');
					error.code = 'woocommerce_api_unavailable';
					error.data = { status: 503 };
					throw error;
				}
				if (data.action !== 'status' && writeDelay > 0) {
					await new Promise((resolve) => setTimeout(resolve, writeDelay));
				}
				if (data.action === 'choice' && !failWrite) granted = true;
				if (data.action === 'withdraw' && !failWrite) granted = false;
				let status = 'checked';
				if (data.action !== 'status') {
					status = failWrite ? 'unverified' : 'recorded';
				}
				if (data.action === 'choice' && noChoiceAck) return;
				const response = {
					requestId: data.requestId,
					status,
					confirmed: data.action === 'status' ? (granted && !failStatus) : false,
					reason: failWrite && data.action !== 'status' ? failWriteReason : '',
				};
				const deliver = () => {
					cart.extensions['moda-interact-consent'] = response;
					for (const callback of [...subscriptions]) callback();
					if (ackEphemeral) {
						// Woo's ordinary checkout refresh may immediately overwrite
						// the cart extension slot with a requestId-less idle value.
						cart.extensions['moda-interact-consent'] = {
							requestId: '', status: 'idle', confirmed: false, reason: '',
						};
						for (const callback of [...subscriptions]) callback();
					}
				};
				if (ackDelay) setTimeout(deliver, ackDelay);
				else deliver();
			},
		} },
		console: { info: (...args) => messages.push(args) },
	};
	runInNewContext(source, { window: win });
	async function settle() {
		await new Promise((resolve) => setTimeout(resolve, 30));
		await new Promise((resolve) => setImmediate(resolve));
	}
	function clickImmediate() {
		input.checked = !input.checked; // Browser performs the toggle first.
		const desired = input.checked;
		events.change({ isTrusted: true, target: input });
		assert.equal(
			input.checked,
			desired,
			'Network work cannot revert a shopper click'
		);
		assert.equal(
			input.disabled,
			false,
			'Requests cannot disable consent selection'
		);
	}
	async function click() {
		clickImmediate();
		await settle();
	}
	return {
		input, writes, messages, settle, click, clickImmediate,
		setPhone(value) { cart.billingAddress.phone = value; subscriptions.forEach((s) => s()); },
		rerenderNative() { input.checked = false; subscriptions.forEach((s) => s()); },
		setFailWrite(value) { failWrite = value; },
		setFailStatus(value) { failStatus = value; },
		setFailTransport(value) { failTransport = value; },
		get granted() { return granted; },
	};
}

test('verified grant checks the native field without publishing a duplicate GRANT', async () => {
	const app = fixture({ granted: true });
	await app.settle();
	assert.equal(app.input.checked, true);
	assert.deepEqual(app.writes.map((w) => w.action), ['status']);
	await app.click();
	assert.equal(app.input.checked, false);
	assert.equal(app.writes.at(-1).action, 'withdraw');
	assert.equal(app.granted, false);
});

test('no grant starts unchecked; deliberate click publishes one choice and verifies status', async () => {
	const app = fixture();
	await app.settle();
	assert.equal(app.input.checked, false);
	await app.click();
	assert.equal(app.input.checked, true);
	assert.deepEqual(app.writes.map((w) => w.action), ['status', 'choice', 'status']);
	assert.equal(app.granted, true);
	assert.deepEqual(app.messages, [], 'No technical messages on the storefront');
});

test('failed GRANT keeps the clicked checkbox checked without recording consent', async () => {
	const app = fixture({ failWrite: true });
	await app.settle();
	await app.click();
	assert.equal(app.granted, false, 'Backend status quo remains ungranted');
	assert.equal(app.input.checked, true, 'UI does not revert after failed GRANT');
	assert.equal(app.input.disabled, false);
	assert.equal(app.writes.filter((w) => w.action === 'choice').length, 1);
});

test('failed REVOKE keeps the checkbox unchecked but preserves backend grant and retry identity', async () => {
	const app = fixture({ granted: true, failWrite: true });
	await app.settle();
	await app.click();
	assert.equal(
		app.input.checked,
		false,
		'UI follows uncheck despite backend failure'
	);
	assert.equal(
		app.granted,
		true,
		'The failed REVOKE does not remove the grant'
	);
	const id = app.writes.at(-1).requestId;
	await app.click();
	assert.equal(app.input.checked, true);
	assert.equal(
		app.writes.at(-1).requestId,
		id,
		'Checking again cannot duplicate an existing GRANT'
	);
	app.setFailWrite(false);
	await app.click();
	assert.equal(app.writes.at(-1).requestId, id);
	assert.equal(app.input.checked, false);
	assert.equal(app.granted, false);
});

test('status outage and phone changes never publish consent automatically', async () => {
	const app = fixture({ granted: true, failStatus: true });
	await app.settle();
	assert.equal(app.input.checked, false);
	app.setPhone('+447400123457');
	await app.settle();
	assert.equal(app.input.checked, false);
	assert.equal(app.writes.every((w) => w.action === 'status'), true);
});

test('a pre-phone click stays visible through first billing entry, but cannot silently grant', async () => {
	const app = fixture({ phone: '' });
	await app.settle();
	await app.click();
	assert.equal(app.input.checked, true, 'The explicit pre-phone choice is visible');
	assert.equal(app.writes.length, 0);
	app.setPhone('+447400123456');
	await app.settle();
	assert.equal(app.input.checked, true, 'Typing the initial phone cannot undo the click');
	assert.equal(app.writes.every((w) => w.action === 'status'), true);
	assert.equal(app.granted, false, 'A phone appearing cannot publish a new GRANT');
	app.rerenderNative();
	await app.settle();
	assert.equal(app.input.checked, true, 'Native Woo checkout re-render preserves selection');
	// An unchecked-then-checked deliberate interaction WITH the contact
	// established is the only way to publish a grant in this checkout.
	await app.click();
	assert.equal(app.input.checked, false);
	assert.equal(app.writes.every((w) => w.action === 'status'), true);
	await app.click();
	assert.equal(app.granted, true);
	assert.equal(app.writes.filter((w) => w.action === 'choice').length, 1);
});

test('a pre-phone visual choice cannot cross a subsequent phone change', async () => {
	const app = fixture({ phone: '' });
	await app.settle();
	await app.click();
	app.setPhone('+447400123456');
	await app.settle();
	assert.equal(app.input.checked, true);
	app.setPhone('+447400123457');
	await app.settle();
	assert.equal(app.input.checked, false, 'Initial contact is now bound and changed');
	assert.equal(app.granted, false);
	assert.equal(app.writes.every((w) => w.action === 'status'), true);
});

test('missing native Woo runtime never throws or affects checkout', () => {
	assert.doesNotThrow(() => runInNewContext(source, { window: {} }));
	assert.doesNotThrow(() => runInNewContext(source, { window: { document: {}, wp: {} } }));
});

test('an unavailable status request does not block new checkbox choices', async () => {
	const app = fixture({ failStatus: true });
	await app.settle();
	assert.equal(app.input.checked, false);
	await app.click();
	assert.equal(app.input.checked, true);
	assert.equal(app.input.disabled, false);
	assert.equal(app.granted, true, 'Only an acknowledged command changes backend state');
});

test('programmatic render changes never become consent operations', async () => {
	const app = fixture({ granted: true });
	await app.settle();
	assert.equal(app.input.checked, true);
	app.setPhone('+447400123457');
	await app.settle();
	assert.deepEqual(
		app.writes.map((w) => w.action),
		['status', 'status']
	);
});

test('rapid changes stay interactive and the final deliberate choice wins', async () => {
	const app = fixture({ writeDelay: 50 });
	await app.settle();
	app.clickImmediate(); // GRANT in flight.
	assert.equal(app.input.checked, true);
	app.clickImmediate(); // REVOKE queued, no disabled input.
	assert.equal(app.input.checked, false);
	app.clickImmediate(); // GRANT queued after REVOKE.
	assert.equal(app.input.checked, true);
	await new Promise((resolve) => setTimeout(resolve, 260));
	assert.equal(app.input.checked, true);
	assert.equal(app.granted, true);
	assert.deepEqual(
		app.writes.filter((w) => w.action !== 'status').map((w) => w.action),
		['choice', 'withdraw', 'choice']
	);
	assert.equal(
		new Set(
			app.writes
				.filter((w) => w.action === 'choice')
				.map((w) => w.requestId)
		).size,
		2,
		'Distinct deliberate transitions must not reuse stale GRANT request identities'
	);
	assert.deepEqual(app.messages, []);
});


test('a delayed cart-store acknowledgement is captured after the Woo promise resolves', async () => {
	const app = fixture({ ackDelay: 12 });
	await app.settle();
	await app.click();
	assert.equal(app.granted, true);
	assert.deepEqual(app.writes.map((w) => w.action), ['status', 'choice', 'status']);
	assert.equal(app.input.checked, true);
});

test('a short-lived matching acknowledgement survives an immediate checkout idle refresh', async () => {
	const app = fixture({ ackEphemeral: true });
	await app.settle();
	await app.click();
	assert.equal(app.granted, true);
	assert.deepEqual(app.writes.map((w) => w.action), ['status', 'choice', 'status']);
	await app.click();
	assert.equal(app.granted, false, 'The protected withdrawal still receives its ACK');
	assert.equal(app.input.checked, false);
});

test('a pre-publication rejected GRANT cannot trigger a proofless withdrawal', async () => {
	const app = fixture({ failWrite: true, failWriteReason: 'store_api_expected_phone_unparseable' });
	await app.settle();
	await app.click();
	await app.click();
	assert.equal(app.input.checked, false);
	assert.equal(app.granted, false);
	assert.deepEqual(app.writes.map((w) => w.action), ['status', 'choice']);
});

test('a queued uncheck after a pre-publication rejection cannot publish REVOKE', async () => {
	const app = fixture({ failWrite: true, writeDelay: 40 });
	await app.settle();
	app.clickImmediate();
	app.clickImmediate();
	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.deepEqual(app.writes.map((w) => w.action), ['status', 'choice']);
	assert.equal(app.input.checked, false);
});

test('ambiguous lost GRANT acknowledgement still invokes protected withdrawal', async () => {
	const app = fixture({ failWrite: true, failWriteReason: 'capture_observe_grant_publish_unacknowledged' });
	await app.settle();
	await app.click();
	await app.click();
	assert.deepEqual(app.writes.map((w) => w.action), ['status', 'choice', 'withdraw']);
});

test('development diagnostics retain the original HTTP failure and reason without exposing contacts', async () => {
	const app = fixture({ failTransport: true, debugEnabled: true });
	await app.settle();
	await app.click();
	const failure = app.messages.find(([event, name]) =>
		event === '[Moda Woo Consent]' && name === 'blocks_http_rejected');
	assert.ok(failure, 'Transport rejection has explicit diagnostic event');
	assert.equal(failure[2].errorCode, 'woocommerce_api_unavailable');
	assert.equal(failure[2].httpStatus, 503);
	assert.equal(failure[2].originalMessage, 'Store API rejected consent with HTTP 503');
	assert.equal(failure[2].action, 'choice');
	assert.equal(JSON.stringify(failure[2]).includes('+447400123456'), false);
});

test('a server rejection reason is reported without conflating it with HTTP failure', async () => {
	const app = fixture({ failWrite: true, failWriteReason: 'capture_observe_installation_ineligible', debugEnabled: true });
	await app.settle();
	await app.click();
	assert.ok(app.messages.some((message) => message[1] === 'blocks_http_response' &&
		message[2].status === 'unverified' &&
		message[2].reason === 'capture_observe_installation_ineligible'));
	assert.ok(app.messages.some((message) => message[1] === 'blocks_choice_failed' &&
		message[2].reason === 'capture_observe_installation_ineligible'));
});


test('a lost GRANT ACK remains ambiguous and a later explicit uncheck attempts protected withdrawal', async () => {
	const app = fixture({ noChoiceAck: true, fastTimeout: true, debugEnabled: true });
	await app.settle();
	await app.click();
	assert.equal(app.input.checked, true, 'The shopper choice remains displayed after timeout');
	assert.equal(app.granted, true, 'The backend may have committed despite a missing acknowledgement');
	assert.ok(app.messages.some((message) => message[1] === 'blocks_http_rejected' &&
		message[2].stage === 'acknowledgement' &&
		message[2].originalMessage === 'consent_ack_timeout'));
	await app.click();
	assert.equal(app.input.checked, false);
	assert.equal(app.granted, false, 'Uncheck still attempts protected withdrawal after ambiguous GRANT');
	assert.deepEqual(app.writes.map((w) => w.action), ['status', 'choice', 'withdraw']);
});
