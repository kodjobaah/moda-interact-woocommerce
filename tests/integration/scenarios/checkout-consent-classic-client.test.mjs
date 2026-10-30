import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(
	resolve('assets/js/checkout-consent-classic.js'),
	'utf8'
);

test('Classic checkbox submits only an explicit checked action, never an unchecked REVOKE', () => {
	const body = {};
	const checkbox = { checked: true, disabled: false };
	const listeners = new Map();
	let updates = 0;
	let actionMarker = null;
	const form = {
		length: 1,
		find: () => ({ remove: () => (actionMarker = null) }),
	};
	function jQuery(target, properties) {
		if (target === body) {
			return {
				on: (event, selector, callback) =>
					listeners.set(`${event}:${selector}`, callback),
				trigger: () => updates++,
			};
		}
		if (target === checkbox) {
			return { closest: () => form };
		}
		if (target === '<input>') {
			return { appendTo: () => (actionMarker = properties) };
		}
		throw new Error('Unexpected jQuery target');
	}
	vm.runInNewContext(source, { jQuery, document: { body }, window: {} });
	const change = listeners.get(
		'change:input[name="moda_interact_whatsapp_recovery_opt_in"]'
	);
	assert.equal(typeof change, 'function');
	change.call(checkbox);
	assert.equal(
		actionMarker.name,
		'moda_interact_whatsapp_recovery_checked_action'
	);
	checkbox.checked = false;
	change.call(checkbox);
	assert.equal(actionMarker, null, 'Unchecking never sets a revoke marker');
	assert.equal(updates, 2);
	assert.doesNotMatch(source, /\/v1\/woocommerce\/whatsapp-consent/);
	assert.match(source, /request\('withdraw'/);
});

test('Classic proof-backed status and confirmed withdrawal use the same Woo session', async () => {
	const body = {};
	const doc = { body };
	const withdrawButton = { disabled: false };
	const listeners = new Map();
	const props = new Map();
	const texts = new Map();
	const requests = [];
	const controlRow = { visible: true };
	const checkout = {
		length: 1,
		first() {
			return this;
		},
		serialize: () => 'billing_phone=%2B447400123456&billing_country=GB',
		find: (selector) => {
			if (selector.includes('billing_phone')) {
				return { val: () => '+447400123456' };
			}
			if (selector.includes('billing_country')) {
				return { val: () => 'GB' };
			}
			return { remove: () => {} };
		},
	};
	function elem(key) {
		return {
			length: 1,
			prop(name, value) {
				if (arguments.length > 1) {
					props.set(`${key}.${name}`, value);
				}
				return props.get(`${key}.${name}`);
			},
			text(value) {
				texts.set(key, value);
				return this;
			},
			closest() {
				return { toggle: (visible) => (controlRow.visible = visible) };
			},
		};
	}
	function jQuery(target) {
		if (target === body) {
			return {
				on: (name, selector, callback) =>
					listeners.set(`${name}:${selector}`, callback),
			};
		}
		if (target === doc) {
			return { ready: (callback) => callback() };
		}
		if (target === 'form.checkout') {
			return checkout;
		}
		if (target === withdrawButton) {
			return elem('withdrawButton');
		}
		return elem(target);
	}

	const window = {
		modaWooCheckoutConsentConfig: {
			statusEndpoint: '/?wc-ajax=moda_interact_checkout_consent_status',
			withdrawEndpoint:
				'/?wc-ajax=moda_interact_checkout_consent_withdraw',
			nonce: 'fixture-nonce',
			granted: 'Already granted',
			withdraw: 'Withdraw WhatsApp permission',
			confirm: 'Are you sure?',
			changeFailed: 'Please try again',
		},
		confirm: () => true,
	};
	const fetch = async (url, options) => {
		requests.push({ url, options });
		return {
			ok: true,
			status: 200,
			json: async () =>
				url.endsWith('status')
					? { confirmed: true, reason: '' }
					: { status: 'withdrawn' },
		};
	};
	vm.runInNewContext(source, {
		jQuery,
		document: doc,
		window,
		fetch,
		URLSearchParams,
	});
	await new Promise((done) => setImmediate(done));
	assert.equal(controlRow.visible, false, 'Confirmed GRANT hides the opt-in');
	assert.equal(props.get('#moda-woo-consent-current-status.hidden'), false);
	assert.equal(
		texts.get('#moda-woo-consent-granted-label'),
		'Already granted'
	);
	const withdraw = listeners.get('click:#moda-woo-consent-withdraw');
	assert.equal(typeof withdraw, 'function');
	await withdraw.call(withdrawButton, { preventDefault() {} });
	assert.equal(
		controlRow.visible,
		true,
		'Hosted REVOKE ACK restores neutral opt-in'
	);
	assert.equal(
		props.get(
			'input[name="moda_interact_whatsapp_recovery_opt_in"].checked'
		),
		false
	);
	assert.equal(props.get('#moda-woo-consent-current-status.hidden'), true);
	assert.equal(requests.length, 2);
	assert.equal(requests[1].url.endsWith('_withdraw'), true);
	const payload = new URLSearchParams(requests[1].options.body);
	assert.equal(payload.get('mode'), 'CLASSIC');
	assert.equal(payload.get('confirmed'), '1');
	assert.equal(payload.get('security'), 'fixture-nonce');
	assert.equal(
		requests[1].options.headers['Content-Type'],
		'application/x-www-form-urlencoded'
	);
	assert.equal(requests[1].options.credentials, 'same-origin');
	assert.ok(!source.includes('grantEventId'));
});
