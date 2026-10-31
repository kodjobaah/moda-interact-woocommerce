import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const script = readFileSync(join(repo, 'assets/js/checkout-consent-blocks-status.js'), 'utf8');

test('Blocks diagnostic logging is opt-in and never logs provider/customer contents', () => {
	const calls = [];
	assert.doesNotThrow(() => runInNewContext(script, {
		window: { sessionStorage: { getItem: () => null }, console: {
			info: (...args) => calls.push(args),
		} },
	}));
	assert.deepEqual(calls, []);
	assert.doesNotMatch(script, /console\.error|JSON\.stringify\(result\)/);
});
