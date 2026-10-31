import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const script = readFileSync(join(repo, 'assets/js/checkout-consent-blocks-status.js'), 'utf8');

test('verified status is server-only; explicit local choice determines display until reload', () => {
	assert.match(script, /verified = result\.confirmed === true/);
	assert.match(script, /verified = status\.confirmed === true/);
	assert.match(script, /field\.checked = localChoice === null \? verified : localChoice/);
});

test('only a deliberate trusted checkbox change publishes and confirmation is never displayed', () => {
	assert.match(script, /event\.isTrusted !== true/);
	assert.match(script, /doc\.addEventListener\('change', onChange, true\)/);
	assert.doesNotMatch(script, /event\.preventDefault\(\)/);
	assert.doesNotMatch(script, /confirm\(/);
});
