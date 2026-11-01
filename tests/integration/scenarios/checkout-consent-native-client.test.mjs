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
		MutationObserver: class { observe() {} },
		setTimeout(callback, ms) { return setTimeout(callback, ms === 450 ? 0 : ms); },
		clearTimeout,
		wp: { data: {
			select: () => ({ getCartData: () => cart }),
			subscribe: (callback) => subscriptions.push(callback),
		} },
		wc: { blocksCheckout: {
			extensionCartUpdate: async ({ namespace, overwriteDirtyCustomerData, data }) => {
				assert.equal(namespace, 'moda-interact-consent');
				assert.equal(overwriteDirtyCustomerData, false);
				writes.push(data);
				if (data.action !== 'status' && writeDelay > 0) {
					await new Promise((resolve) => setTimeout(resolve, writeDelay));
				}
				if (data.action === 'choice' && !failWrite) granted = true;
				if (data.action === 'withdraw' && !failWrite) granted = false;
				let status = 'checked';
				if (data.action !== 'status') {
					status = failWrite ? 'unverified' : 'recorded';
				}
				cart.extensions['moda-interact-consent'] = {
					requestId: data.requestId,
					status,
					confirmed: data.action === 'status' ? (granted && !failStatus) : false,
				};
				for (const callback of subscriptions) callback();
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
