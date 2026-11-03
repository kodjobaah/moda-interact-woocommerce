import assert from 'node:assert/strict';
import test from 'node:test';
import {
	siteUrlFromWpEnvStatus,
	assertConsentFixtureSiteIdentity,
} from './wp-env-status.mjs';

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

test('consent-only accepts a fixture bound to the running nondefault port', () => {
	assert.doesNotThrow(() =>
		assertConsentFixtureSiteIdentity('http://localhost:8890', {
			effectiveSiteUrl: 'http://localhost:8890/',
			installationSiteUrl: 'http://localhost:8890',
		})
	);
});

test('consent-only refuses a stale installation after a wp-env port change', () => {
	assert.throws(
		() =>
			assertConsentFixtureSiteIdentity('http://localhost:8890', {
				effectiveSiteUrl: 'http://localhost:8890',
				installationSiteUrl: 'http://localhost:8888',
			}),
		/Stored Moda fixture installation is bound to another WordPress origin/
	);
});

test('consent-only refuses a stale WordPress home URL before changing test state', () => {
	assert.throws(
		() =>
			assertConsentFixtureSiteIdentity('http://localhost:8890', {
				effectiveSiteUrl: 'http://localhost:8888',
				installationSiteUrl: 'http://localhost:8890',
			}),
		/WordPress home_url does not match/
	);
});

test('consent-only handles missing site identity without echoing a stored URL', () => {
	assert.throws(
		() =>
			assertConsentFixtureSiteIdentity('http://localhost:8890', {
				effectiveSiteUrl: 'http://localhost:8890',
				installationSiteUrl: null,
			}),
		(error) =>
			/Stored Moda fixture installation/.test(error.message) &&
			!error.message.includes('https://merchant.example')
	);
});
