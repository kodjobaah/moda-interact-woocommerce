import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newForKey } from './checkout-clear-refill-wordpress.mjs';

function action(id, attempt, eventId, checkoutKey, items = []) {
	return {
		id: String(id),
		args: {
			attempt,
			event: {
				eventType: 'CHECKOUT_UPDATED',
				eventId,
				checkoutKey,
				checkout: { items },
			},
		},
	};
}

test('ignores retries and already published nonempty events when checking repeated empty requests', () => {
	const original = action(56, 1, 'woo-old', 'woo-key', [{ quantity: 1 }]);
	const empty = action(59, 1, 'woo-empty', 'woo-key');
	const before = [original, empty];
	const after = [
		...before,
		action(60, 2, 'woo-old', 'woo-key', [{ quantity: 1 }]),
		action(61, 2, 'woo-empty', 'woo-key'),
	];
	assert.deepEqual(newForKey(before, after, 'woo-key'), []);
});

test('counts exactly one genuinely new keyed empty event and later refill', () => {
	const initial = action(10, 1, 'woo-initial', 'woo-key', [{ quantity: 1 }]);
	const cleared = action(11, 1, 'woo-cleared', 'woo-key');
	assert.deepEqual(newForKey([initial], [initial, cleared], 'woo-key'), [
		cleared,
	]);
	const refill = action(13, 1, 'woo-refill', 'woo-key', [{ quantity: 2 }]);
	assert.deepEqual(
		newForKey(
			[initial, cleared],
			[initial, cleared, action(12, 2, 'woo-cleared', 'woo-key'), refill],
			'woo-key'
		),
		[refill]
	);
});

test('does not hide a second fresh empty publication with a distinct ID', () => {
	const prior = action(10, 1, 'woo-before', 'woo-key', [{ quantity: 1 }]);
	const empty1 = action(11, 1, 'woo-empty-1', 'woo-key');
	const empty2 = action(12, 1, 'woo-empty-2', 'woo-key');
	assert.deepEqual(newForKey([prior], [prior, empty1, empty2], 'woo-key'), [
		empty1,
		empty2,
	]);
});

test('isolates checkout keys and excludes non-checkout events', () => {
	const event = action(20, 1, 'woo-someone-else', 'woo-other');
	assert.deepEqual(newForKey([], [event], 'woo-key'), []);
	const order = action(21, 1, 'woo-order', 'woo-key');
	order.args.event.eventType = 'ORDER_PLACED';
	assert.deepEqual(newForKey([], [order], 'woo-key'), []);
});
