import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(
	resolve('assets/js/checkout-consent-classic.js'),
	'utf8'
);

test('Classic checkbox updates checkout only on explicit selection change', () => {
	const body = {};
	const checkbox = { checked: true };
	let listener;
	let ajaxReview = 0;
	let actionMarker;
	const form = { length: 1, find: () => ({ remove: () => {} }) };
	function jQuery(target, properties) {
		if (target === body) {
			return {
				on(event, selector, callback) {
					assert.equal(event, 'change');
					assert.equal(
						selector,
						'input[name="moda_interact_whatsapp_recovery_opt_in"]'
					);
					listener = callback;
				},
				trigger(event) {
					assert.equal(event, 'update_checkout');
					ajaxReview++;
				},
			};
		}
		if (target === checkbox) {
			return { closest: () => form };
		}
		if (target === '#moda-woo-consent-current-status') {
			return { length: 0, prop: () => {} };
		}
		if (target === '<input>') {
			return { appendTo: () => (actionMarker = properties) };
		}
		throw new Error('Unexpected jQuery target');
	}
	vm.runInNewContext(source, { jQuery, document: { body }, window: {} });
	assert.equal(typeof listener, 'function');
	listener.call(checkbox);
	assert.equal(ajaxReview, 1);
	assert.equal(
		actionMarker.name,
		'moda_interact_whatsapp_recovery_checked_action'
	);
	// The browser only uses same-origin WP REST. Hosted Moda credentials/proofs
	// are not included in the checkout JavaScript source.
	assert.doesNotMatch(source, /\/v1\/woocommerce\/whatsapp-consent/);
	assert.match(source, /request\(\{\s*mode:\s*'CLASSIC'/);
	assert.doesNotMatch(source, /data-moda-woo-withdraw/);
});
