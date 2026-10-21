import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newCheckoutActions } from './checkout-wordpress.mjs';

test('finds added actions even when the scheduler reorders its rows', () => {
	const before = [{ id: 24 }, { id: 25 }];
	const after = [{ id: 27 }, { id: 24 }, { id: 26 }, { id: 25 }];
	assert.deepEqual(
		newCheckoutActions(before, after).map((row) => row.id),
		[27, 26]
	);
});

test('does not mistake reordered or differently typed IDs for new actions', () => {
	const before = [{ id: 5 }, { id: '6' }];
	const after = [{ id: 6 }, { id: '5' }];
	assert.deepEqual(newCheckoutActions(before, after), []);
});

test('recognizes the new action ID for a retry independently of its payload', () => {
	const before = [{ id: 91, args: { attempt: 1 } }];
	const after = [before[0], { id: 92, args: { attempt: 2 } }];
	assert.deepEqual(
		newCheckoutActions(before, after).map((row) => row.id),
		[92]
	);
});
