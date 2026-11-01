import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(
	resolve('assets/js/checkout-consent-classic.js'),
	'utf8'
);

test('unchecked neutral Classic choice is not a REVOKE and only explicit check stages GRANT', () => {
	const body = {};
	const checkbox = { checked: true, disabled: false };
	const listeners = new Map();
	let updates = 0;
	let actionMarker = null;
	const form = {
		length: 1,
		first() {
			return this;
		},
		find: (selector) => {
			if (selector.includes('billing_phone')) {
				return { val: () => '+447400123456' };
			}
			if (selector.includes('billing_country')) {
				return { val: () => 'GB' };
			}
			return { remove: () => (actionMarker = null) };
		},
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
		if (target === 'form.checkout') {
			return form;
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
	change.call(checkbox, { originalEvent: { isTrusted: true } });
	assert.equal(
		actionMarker.name,
		'moda_interact_whatsapp_recovery_checked_action'
	);
	checkbox.checked = false;
	change.call(checkbox, { originalEvent: { isTrusted: true } });
	assert.equal(actionMarker, null, 'Unchecking never sets a revoke marker');
	assert.equal(updates, 2);
	assert.doesNotMatch(source, /\/v1\/woocommerce\/whatsapp-consent/);
	assert.match(source, /request\('withdraw'/);
});

test('Classic verified checkbox uncheck performs proof-backed REVOKE with same Woo session', async () => {
	const body = {};
	const doc = { body };
	const consentCheckbox = { checked: false, disabled: false };
	const listeners = new Map();
	const props = new Map();
	const texts = new Map();
	const requests = [];
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
					return this;
				}
				return props.get(`${key}.${name}`);
			},
			text(value) {
				texts.set(key, value);
				return this;
			},
		};
	}
	function jQuery(target) {
		if (target === body) {
			return {
				on: (name, selector, callback) =>
					listeners.set(`${name}:${selector}`, callback),
				trigger() {},
			};
		}
		if (target === doc) {
			return { ready: (callback) => callback() };
		}
		if (target === 'form.checkout') {
			return checkout;
		}
		if (target === consentCheckbox) {
			return { closest: () => checkout };
		}
		return elem(target);
	}

	const window = {
		modaWooCheckoutConsentConfig: {
			statusEndpoint: '/?wc-ajax=moda_interact_checkout_consent_status',
			withdrawEndpoint:
				'/?wc-ajax=moda_interact_checkout_consent_withdraw',
			nonce: 'fixture-nonce',
		},
	};
	let withdrawalFailed = true;
	let serverGranted = true;
	const fetch = async (url, options) => {
		if (url.endsWith('withdraw') && !withdrawalFailed) {
			serverGranted = false;
		}
		requests.push({ url, options });
		return {
			ok: url.endsWith('status') || !withdrawalFailed,
			status: withdrawalFailed && url.endsWith('withdraw') ? 503 : 200,
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
	assert.equal(
		props.get('input[name="moda_interact_whatsapp_recovery_opt_in"].checked'),
		true,
		'Confirmed grant checks the existing checkbox'
	);
	assert.equal(
		props.get('input[name="moda_interact_whatsapp_recovery_opt_in"].disabled'),
		false,
		'Verified consent can be revoked by deliberate uncheck'
	);
	assert.equal(texts.has('#moda-woo-consent-granted-label'), false);
	assert.equal(texts.has('#moda-woo-consent-action-error'), false);
	const change = listeners.get(
		'change:input[name="moda_interact_whatsapp_recovery_opt_in"]'
	);
	assert.equal(typeof change, 'function');
	consentCheckbox.checked = false;
	change.call(consentCheckbox, { originalEvent: { isTrusted: true } });
	await new Promise((done) => setImmediate(done));
	assert.equal(
		serverGranted,
		true,
		'Failed withdrawal retains the stored GRANT'
	);
	assert.equal(
		props.get('input[name="moda_interact_whatsapp_recovery_opt_in"].checked'),
		false,
		'Failed REVOKE must not override the deliberate uncheck'
	);
	assert.equal(texts.has('#moda-woo-consent-action-error'), false);
	consentCheckbox.checked = true;
	change.call(consentCheckbox, { originalEvent: { isTrusted: true } });
	withdrawalFailed = false;
	consentCheckbox.checked = false;
	change.call(consentCheckbox, { originalEvent: { isTrusted: true } });
	await new Promise((done) => setImmediate(done));
	assert.equal(
		props.get('input[name="moda_interact_whatsapp_recovery_opt_in"].checked'),
		false,
		'The checkbox remains unchecked while the backend confirms withdrawal'
	);
	assert.equal(texts.has('#moda-woo-consent-action-error'), false);
	assert.equal(
		serverGranted,
		false,
		'A successful withdrawal changes durable consent'
	);
	assert.equal(listeners.has('click:#moda-woo-consent-withdraw'), false);
	assert.equal(requests.length, 3);
	assert.equal(requests[2].url.endsWith('_withdraw'), true);
	const payload = new URLSearchParams(requests[2].options.body);
	assert.equal(payload.get('mode'), 'CLASSIC');
	assert.equal(payload.get('confirmed'), '1');
	assert.equal(payload.get('security'), 'fixture-nonce');
	assert.equal(
		requests[2].options.headers['Content-Type'],
		'application/x-www-form-urlencoded'
	);
	assert.equal(requests[2].options.credentials, 'same-origin');
	assert.ok(!source.includes('grantEventId'));
});

test('Classic consent UI remains interactive during status failures and never stages consent automatically', async () => {
	const body = {};
	const document = { body };
	const listeners = new Map();
	const values = new Map();
	const checkbox = { checked: false, disabled: false };
	let markers = [];
	let updates = 0;
	const checkout = {
		length: 1,
		first() {
			return this;
		},
		serialize: () => 'billing_phone=%2B447400123456&billing_country=GB',
		find(selector) {
			if (selector.includes('billing_phone')) {
				return { val: () => '+447400123456' };
			}
			if (selector.includes('billing_country')) {
				return { val: () => 'GB' };
			}
			return {
				remove: () => {
					markers = [];
				},
			};
		},
	};
	function jQuery(target, properties) {
		if (target === body) {
			return {
				on: (event, selector, callback) =>
					listeners.set(`${event}:${selector}`, callback),
				trigger: () => {
					updates++;
				},
			};
		}
		if (target === document) {
			return { ready: (fn) => fn() };
		}
		if (target === 'form.checkout') {
			return checkout;
		}
		if (target === checkbox) {
			return { closest: () => checkout };
		}
		if (target === '<input>') {
			return { appendTo: () => markers.push(properties) };
		}
		return {
			length: 1,
			prop(key, value) {
				values.set(`${target}.${key}`, value);
				if (target.includes('moda_interact_whatsapp_recovery_opt_in')) {
					checkbox[key] = value;
				}
				return this;
			},
		};
	}
	const window = {
		modaWooCheckoutConsentConfig: {
			statusEndpoint: '/status',
			withdrawEndpoint: '/withdraw',
			nonce: 'fixture',
		},
	};
	const fetch = async () => ({ ok: false, status: 503 });
	vm.runInNewContext(source, {
		jQuery,
		window,
		document,
		fetch,
		URLSearchParams,
		setTimeout,
		clearTimeout,
	});
	await new Promise((done) => setImmediate(done));
	const change = listeners.get(
		'change:input[name="moda_interact_whatsapp_recovery_opt_in"]'
	);
	checkbox.checked = true;
	change.call(checkbox, { originalEvent: { isTrusted: true } });
	assert.equal(
		values.get('input[name="moda_interact_whatsapp_recovery_opt_in"].disabled'),
		false
	);
	assert.equal(
		markers.at(-1)?.name,
		'moda_interact_whatsapp_recovery_checked_action'
	);
	assert.equal(updates, 1);
	await new Promise((done) => setTimeout(done, 10));
	assert.equal(
		checkbox.checked,
		true,
		'A failed status read cannot undo a deliberate check'
	);
});


test('Classic pre-phone checkbox choice survives first billing entry without auto-grant', async () => {
	const body = {};
	const document = { body };
	const listeners = new Map();
	const box = { checked: false, disabled: false };
	let phone = '';
	const country = 'GB';
	const calls = [];
	const checkout = {
		length: 1,
		first() { return this; },
		serialize() { return `billing_phone=${encodeURIComponent(phone)}&billing_country=${country}`; },
		find(selector) {
			if (selector.includes('billing_phone')) return { val: () => phone };
			if (selector.includes('billing_country')) return { val: () => country };
			return { remove() {} };
		},
	};
	function jQuery(target) {
		if (target === body) return {
			on(name, selector, callback) {
				listeners.set(`${name}:${typeof selector === 'string' ? selector : '*'}`, callback || selector);
			},
			trigger() {},
		};
		if (target === document) return { ready(callback) { callback(); } };
		if (target === 'form.checkout') return checkout;
		if (target === box) return { closest: () => checkout };
		if (target === '<input>') return { appendTo() {} };
		if (target === 'input[name="moda_interact_whatsapp_recovery_opt_in"]') return {
			length: 1,
			prop(name, value) {
				if (arguments.length > 1) box[name] = value;
				return box[name];
			},
		};
		throw new Error('Unexpected jQuery selection');
	}
	const fetch = async (url) => {
		calls.push(url);
		return { ok: true, status: 200, json: async () => ({ confirmed: false }) };
	};
	vm.runInNewContext(source, {
		jQuery, document, fetch, URLSearchParams,
		window: {
			modaWooCheckoutConsentConfig: { statusEndpoint: '/status', withdrawEndpoint: '/withdraw', nonce: 'test' },
		},
		setTimeout: (callback, ms) => setTimeout(callback, ms === 450 ? 0 : ms),
		clearTimeout,
	});
	const changeChoice = listeners.get('change:input[name="moda_interact_whatsapp_recovery_opt_in"]');
	const changeBilling = listeners.get('change:input[name="billing_phone"], select[name="billing_country"]');
	assert.equal(typeof changeChoice, 'function');
	assert.equal(typeof changeBilling, 'function');
	box.checked = true;
	changeChoice.call(box, { originalEvent: { isTrusted: true } });
	assert.equal(box.checked, true);
	phone = '+447400123456';
	changeBilling();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(box.checked, true, 'First phone entry cannot erase deliberate pre-phone choice');
	assert.equal(calls.every((url) => url === '/status'), true, 'Phone update never writes GRANT');
	phone = '+447400123457';
	changeBilling();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(box.checked, false, 'Subsequent phone change cannot inherit prior choice');
});
