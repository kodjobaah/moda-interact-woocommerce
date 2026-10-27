import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	deliverCapturedAction,
	newCheckoutActions,
} from './checkout-wordpress.mjs';

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

test('replays the exact scheduled checkout/order payload through the WordPress hook', async () => {
	const args = {
		event: {
			schemaVersion: 'woo.activity.v1',
			eventType: 'ORDER_CANCELLED',
			eventId: 'woo-abc',
		},
		installationId: 'install_fixture',
		shopId: 'shop_fixture',
		attempt: 2,
	};
	const commands = [];
	await deliverCapturedAction(
		async (...command) => {
			commands.push(command);
		},
		{ id: 42, args }
	);

	assert.equal(commands.length, 1);
	assert.equal(commands[0][0], 'eval');
	assert.match(
		commands[0][1],
		/^do_action\('moda_interact_dispatch_checkout_activity',/
	);
	const encoded = commands[0][1].match(/base64_decode\('([^']+)'\)/)?.[1];
	assert.ok(
		encoded,
		'scheduled arguments must be encoded for safe WP-CLI evaluation'
	);
	assert.deepEqual(
		JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')),
		args
	);
});
