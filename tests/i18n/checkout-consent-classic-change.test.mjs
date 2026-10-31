import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = readFileSync(
	join(root, 'assets/js/checkout-consent-classic.js'),
	'utf8'
);

test('Classic unchecked state never creates a REVOKE; only a checked click marks GRANT', () => {
	const handlers = new Map();
	const actions = [];
	let hidden = null;
	const checkbox = { checked: false, disabled: false };
	const form = {
		length: 1,
		first() { return this; },
		find(selector) {
			if (selector.includes('billing_phone')) return { val: () => '+447400123456' };
			if (selector.includes('billing_country')) return { val: () => 'GB' };
			return { remove: () => (hidden = null) };
		},
	};
	const body = {};
	function jquery(value, properties) {
		if (value === body) {
			return {
				on: (name, selector, listener) =>
					handlers.set(`${name}:${selector}`, listener),
				trigger: (name) => actions.push(name),
			};
		}
		if (value === '#moda-woo-consent-current-status') {
			return { length: 0, prop: () => {} };
		}
		if (value === checkbox) {
			return { closest: () => form };
		}
		if (value === 'form.checkout') return form;
		if (value === '<input>') {
			return { appendTo: () => (hidden = properties) };
		}
		throw new Error('Unexpected jquery call');
	}
	runInNewContext(script, { jQuery: jquery, document: { body }, window: {} });
	const handler = handlers.get(
		'change:input[name="moda_interact_whatsapp_recovery_opt_in"]'
	);
	assert.equal(typeof handler, 'function');

	checkbox.checked = true;
	handler.call(checkbox, { originalEvent: { isTrusted: true } });
	assert.equal(hidden.name, 'moda_interact_whatsapp_recovery_checked_action');

	checkbox.checked = false;
	handler.call(checkbox, { originalEvent: { isTrusted: true } });
	assert.equal(
		hidden,
		null,
		'Unchecking clears old GRANT; there is no REVOKE marker'
	);
	assert.deepEqual(actions, ['update_checkout', 'update_checkout']);
	checkbox.checked = true;
	handler.call(checkbox, { originalEvent: { isTrusted: false } });
	assert.deepEqual(actions, ['update_checkout', 'update_checkout'],
		'Programmatic Woo form updates cannot stage consent');

	checkbox.checked = true;
	handler.call(checkbox, { originalEvent: { isTrusted: true } });
	assert.equal(
		hidden.name,
		'moda_interact_whatsapp_recovery_checked_action',
		'Rechecking must replace the previous withdrawal marker'
	);
});
