import assert from 'node:assert/strict';
import test from 'node:test';
import { session } from './checkout-wordpress.mjs';

test('follows only same-origin redirects while retaining checkout cookies', async () => {
	const calls = [];
	const browser = session(
		'http://localhost:49152',
		'',
		async (url, options) => {
			calls.push({ url: String(url), options });
			if (calls.length === 1) {
				return new Response('', {
					status: 301,
					headers: {
						location: '/checkout/',
						'set-cookie': 'wc_session=abc; Path=/',
					},
				});
			}
			return new Response('Classic checkout', { status: 200 });
		}
	);
	const response = await browser.request('/checkout');
	assert.equal(await response.text(), 'Classic checkout');
	assert.equal(calls.length, 2);
	assert.equal(calls[1].url, 'http://localhost:49152/checkout/');
	assert.equal(
		new Headers(calls[1].options.headers).get('cookie'),
		'wc_session=abc'
	);
	assert.equal(
		new Headers(calls[1].options.headers).get('connection'),
		'close'
	);
	assert.equal(calls[0].options.redirect, 'manual');
});

test('passes Store API nonce and session cookie on the subsequent POST', async () => {
	const calls = [];
	const browser = session(
		'http://localhost:8888',
		'logged_in=token',
		async (url, options) => {
			calls.push({ url: String(url), options });
			return new Response('{}', {
				status: 200,
				headers: calls.length === 1 ? { nonce: 'testnonce' } : {},
			});
		}
	);
	await browser.request('/wp-json/wc/store/v1/cart');
	await browser.request('/wp-json/wc/store/v1/cart/add-item', {
		method: 'POST',
		body: '{"id":1}',
	});
	assert.equal(calls.length, 2);
	assert.equal(calls[1].options.method, 'POST');
	assert.equal(calls[1].options.body, '{"id":1}');
	const headers = new Headers(calls[1].options.headers);
	assert.equal(headers.get('nonce'), 'testnonce');
	assert.equal(headers.get('cookie'), 'logged_in=token');
});

test('does not retry a checkout POST on provider or transport failure', async () => {
	let calls = 0;
	const browser = session('http://localhost:8888', '', async () => {
		calls += 1;
		throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
	});
	await assert.rejects(
		browser.request('/wp-json/wc/store/v1/checkout', { method: 'PATCH' }),
		/socket closed/
	);
	assert.equal(calls, 1);
});

test('never follows checkout redirects away from the WordPress origin', async () => {
	const browser = session(
		'http://localhost:8888',
		'',
		async () =>
			new Response('', {
				status: 302,
				headers: { location: 'https://external.invalid/' },
			})
	);
	await assert.rejects(
		browser.request('/checkout'),
		/outside the WordPress origin/
	);
});
