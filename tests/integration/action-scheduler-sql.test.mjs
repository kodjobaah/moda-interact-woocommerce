import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parsePendingCheckoutActions,
	readPendingCheckoutActions,
	readCheckoutActionHistory,
} from './action-scheduler-sql.mjs';

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

test('history query includes completed actions while retry query remains pending-only', () => {
	const directory = mkdtempSync(join(tmpdir(), 'moda-checkout-sql-'));
	const oldPath = process.env.PATH;
	const oldCapture = process.env.MODA_SQL_CAPTURE;
	try {
		writeFileSync(
			join(directory, 'docker'),
			`#!/bin/sh
for arg in "$@"; do last="$arg"; done
printf '%s' "$last" > "$MODA_SQL_CAPTURE"
printf '99\\t{"attempt":1,"event":{"eventId":"woo-fixture"}}\\n'
`,
			{ mode: 0o755 }
		);
		process.env.PATH = `${directory}:${oldPath}`;
		process.env.MODA_SQL_CAPTURE = join(directory, 'query.txt');
		assert.equal(
			readPendingCheckoutActions('/test/docker-compose.yml')[0].id,
			'99'
		);
		const pendingSql = readFileSync(process.env.MODA_SQL_CAPTURE, 'utf8');
		assert.match(pendingSql, /a\.status = 'pending'/);
		assert.match(pendingSql, /moda-interact-activity/);
		assert.equal(
			readCheckoutActionHistory('/test/docker-compose.yml')[0].id,
			'99'
		);
		const historySql = readFileSync(process.env.MODA_SQL_CAPTURE, 'utf8');
		assert.doesNotMatch(historySql, /a\.status/);
		assert.match(historySql, /LIMIT 250/);
		assert.match(historySql, /moda-interact-activity/);
	} finally {
		process.env.PATH = oldPath;
		if (oldCapture === undefined) {
			delete process.env.MODA_SQL_CAPTURE;
		} else {
			process.env.MODA_SQL_CAPTURE = oldCapture;
		}
		rmSync(directory, { recursive: true, force: true });
	}
});
