import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePendingCheckoutActions } from './action-scheduler-sql.mjs';

test('parses pending checkout action IDs and JSON args from MariaDB output', () => {
	assert.deepEqual(
		parsePendingCheckoutActions(
			'42\t{"attempt":2,"event":{"eventId":"woo-test"}}\n'
		),
		[{ id: '42', args: { attempt: 2, event: { eventId: 'woo-test' } } }]
	);
});

test('accepts an empty pending-action result', () => {
	assert.deepEqual(parsePendingCheckoutActions(''), []);
});

test('rejects rows without JSON extended args', () => {
	assert.throws(
		() => parsePendingCheckoutActions('42\ta:1:{}\n'),
		/does not have JSON extended_args/
	);
});
