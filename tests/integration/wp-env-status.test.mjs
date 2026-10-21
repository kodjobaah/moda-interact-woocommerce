import assert from 'node:assert/strict';
import test from 'node:test';
import { siteUrlFromWpEnvStatus } from './wp-env-status.mjs';

function status(url = 'http://localhost:8888', port = 8888) {
	return {
		status: 'running',
		runtime: 'docker',
		urls: { development: url },
		ports: { development: port },
	};
}

test('uses the running wp-env URL rather than a hardcoded port', () => {
	assert.equal(siteUrlFromWpEnvStatus(status()), 'http://localhost:8888');
	assert.equal(
		siteUrlFromWpEnvStatus(status('http://localhost:49152', 49152)),
		'http://localhost:49152'
	);
});

test('refuses uninitialized or stopped wp-env instead of guessing a port', () => {
	assert.throws(
		() => siteUrlFromWpEnvStatus({ status: 'uninitialized' }),
		/not running/
	);
	assert.throws(
		() => siteUrlFromWpEnvStatus({ ...status(), status: 'stopped' }),
		/not running/
	);
});

test('refuses inconsistent, nonlocal and missing port reports', () => {
	assert.throws(
		() => siteUrlFromWpEnvStatus(status('http://localhost:8899', 8888)),
		/disagree/
	);
	assert.throws(
		() => siteUrlFromWpEnvStatus(status('http://example.com:8888')),
		/non-local/
	);
	assert.throws(
		() => siteUrlFromWpEnvStatus({ ...status(), ports: {} }),
		/valid development HTTP port/
	);
});

test('requires Docker because the suite executes WP-CLI in a container', () => {
	assert.throws(
		() => siteUrlFromWpEnvStatus({ ...status(), runtime: 'playground' }),
		/Docker runtime/
	);
});
