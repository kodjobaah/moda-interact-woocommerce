import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoConsentCheckoutActivity } from './consent-checkout-isolation.mjs';

function action(id, eventId, productId, eventType = 'CHECKOUT_UPDATED') {
	return {
		id: String(id),
		args: {
			attempt: 1,
			event: {
				eventId,
				eventType,
				checkout: { items: [{ productId: String(productId) }] },
			},
		},
	};
}

test('ignores unrelated checkout jobs and scheduler changes', () => {
	const before = [action(1, 'woo-original', 42)];
	const after = [action(2, 'woo-unrelated', 99)];
	assert.doesNotThrow(() =>
		assertNoConsentCheckoutActivity({
			before,
			after,
			productId: 42,
			context: 'Blocks consent',
		})
	);
});

test('allows scheduler retry of a previously observed eventId', () => {
	const before = [action(3, 'woo-previous', 42)];
	const retry = action(4, 'woo-previous', 42);
	retry.args.attempt = 2;
	assert.doesNotThrow(() =>
		assertNoConsentCheckoutActivity({
			before,
			after: [retry],
			productId: 42,
			context: 'Blocks consent',
		})
	);
});

test('fails on a new checkout event for the consent scenario cart', () => {
	assert.throws(
		() =>
			assertNoConsentCheckoutActivity({
				before: [action(3, 'woo-existing', 42)],
				after: [action(8, 'woo-new', 42)],
				productId: 42,
				context: 'Blocks consent',
			}),
		(error) => {
			assert.equal(error.code, 'ERR_ASSERTION');
			assert.match(error.message, /Blocks consent/);
			assert.match(error.message, /woo-new/);
			assert.doesNotMatch(error.message, /phone|email/i);
			return true;
		}
	);
});

test('ignores order events and retains checkout-specific filtering', () => {
	assert.doesNotThrow(() =>
		assertNoConsentCheckoutActivity({
			before: [],
			after: [action(7, 'woo-order', 42, 'ORDER_PLACED')],
			productId: 42,
			context: 'Classic consent',
		})
	);
});
