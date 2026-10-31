import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = await readFile(
	new URL('../../assets/js/checkout-engagement.js', import.meta.url),
	'utf8'
);

function runClient(surfaceSelector) {
	const listeners = new Map();
	const calls = [];
	class FakeElement {
		closest() {
			return this;
		}
	}
	const surface = {
		contains(target) {
			return target.insideSurface === true;
		},
		addEventListener(name, handler) {
			listeners.set(name, handler);
		},
	};
	const document = {
		querySelector(selector) {
			assert.ok(selector.includes(surfaceSelector));
			return surface;
		},
	};
	const window = {
		ModaWooCheckoutEngagement: {
			url: 'https://merchant.example/wp-json/moda-interact/v1/checkout-engagement',
			nonce: 'session-bound-one-time-nonce',
			wpNonce: 'wordpress-rest-nonce',
		},
		Element: FakeElement,
	};
	runInNewContext(source, {
		window,
		document,
		Element: FakeElement,
		fetch: (...args) => {
			calls.push(args);
			return Promise.resolve({ status: 202 });
		},
	});
	return { calls, listeners, FakeElement };
}

for (const [name, selector] of [
	['Classic cart and checkout', '.woocommerce-cart'],
	['Blocks cart and checkout', '.wp-block-woocommerce-cart'],
]) {
	test(`${name} sends one session signal only after a trusted control interaction`, () => {
		const { calls, listeners, FakeElement } = runClient(selector);
		const target = new FakeElement();
		target.insideSurface = true;
		listeners.get('click')({ isTrusted: false, target });
		assert.equal(calls.length, 0, 'passive or synthetic events do not submit');
		listeners.get('click')({ isTrusted: true, target });
		listeners.get('change')({ isTrusted: true, target });
		assert.equal(calls.length, 1, 'the browser submits at most once per page view');
		assert.equal(calls[0][0], windowUrl());
		assert.equal(calls[0][1].credentials, 'same-origin');
		assert.equal(calls[0][1].keepalive, true);
		assert.equal(calls[0][1].headers['X-WP-Nonce'], 'wordpress-rest-nonce');
		assert.deepEqual(JSON.parse(calls[0][1].body), { nonce: 'session-bound-one-time-nonce' });
	});
}

function windowUrl() {
	return 'https://merchant.example/wp-json/moda-interact/v1/checkout-engagement';
}
