import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(
	resolve('assets/js/checkout-consent-classic.js'),
	'utf8'
);

test('a deliberate Classic checkbox change uses the supported Woo checkout review lifecycle', () => {
	const body = {};
	let listener;
	let ajaxReview = 0;
	function jQuery(target) {
		assert.equal(target, body);
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
	vm.runInNewContext(source, { jQuery, document: { body } });
	assert.equal(typeof listener, 'function');
	listener();
	assert.equal(ajaxReview, 1);
	assert.doesNotMatch(
		source,
		/fetch\(|XMLHttpRequest|\/v1\/woocommerce\/whatsapp-consent/
	);
});
