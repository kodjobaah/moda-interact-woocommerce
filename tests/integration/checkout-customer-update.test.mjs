import assert from 'node:assert/strict';
import { test } from 'node:test';
import { persistBlocksBilling } from './checkout-wordpress.mjs';

const billingAddress = {
	first_name: 'Test',
	last_name: 'Customer',
	country: 'GB',
};

test('Blocks address changes use the cart update-customer endpoint', async () => {
	let calls = 0;
	await persistBlocksBilling(
		{
			async request(path, options) {
				calls += 1;
				assert.equal(path, '/wp-json/wc/store/v1/cart/update-customer');
				assert.equal(options.method, 'POST');
				assert.equal(options.headers['content-type'], 'application/json');
				assert.deepEqual(JSON.parse(options.body), {
					billing_address: billingAddress,
				});
				return {
					status: 200,
					async json() {
						return { billing_address: billingAddress };
					},
				};
			},
		},
		billingAddress,
		'guest'
	);
	assert.equal(calls, 1);
});

test('Blocks update-customer rejects non-success responses', async () => {
	await assert.rejects(
		persistBlocksBilling(
			{
				async request() {
					return { status: 403 };
				},
			},
			billingAddress,
			'guest'
		),
		/cart\/update-customer must succeed/
	);
});

test('Blocks update-customer requires actual persisted contact details', async () => {
	await assert.rejects(
		persistBlocksBilling(
			{
				async request() {
					return {
						status: 200,
						async json() {
							return {
								billing_address: {
									...billingAddress,
									first_name: 'Other',
								},
							};
						},
					};
				},
			},
			billingAddress,
			'guest'
		),
		/cart\/update-customer must persist billing fields/
	);
});
