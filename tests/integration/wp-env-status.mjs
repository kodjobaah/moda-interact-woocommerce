import assert from 'node:assert/strict';

/**
 * Use wp-env's reported running Docker environment, not an assumed HTTP port.
 * The WordPress env package (v11.x) exposes the development URL and port through
 * `wp-env status --json`, including ports chosen automatically at startup.
 * @param {Object} status - Parsed wp-env status response.
 */
export function siteUrlFromWpEnvStatus(status) {
	assert.equal(
		status?.status,
		'running',
		'The project wp-env is not running; start the disposable environment first'
	);
	assert.equal(
		status.runtime,
		'docker',
		'Checkout integration needs the wp-env Docker runtime for WP-CLI'
	);
	assert.equal(
		typeof status.urls?.development,
		'string',
		'wp-env status did not report a development site URL'
	);

	const url = new URL(status.urls.development);
	assert.equal(url.protocol, 'http:', 'Expected the local wp-env HTTP site');
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
		'wp-env reported a non-local WordPress URL'
	);
	assert.equal(url.pathname, '/', 'Expected wp-env site at the URL root');
	assert.equal(url.search, '', 'Unexpected query in wp-env development URL');
	assert.equal(url.hash, '', 'Unexpected fragment in wp-env development URL');

	const port = Number(status.ports?.development);
	assert.ok(
		Number.isInteger(port) && port > 0 && port <= 65535,
		'wp-env status did not report a valid development HTTP port'
	);
	assert.equal(
		Number(url.port || (url.protocol === 'http:' ? 80 : 443)),
		port,
		'wp-env development URL and published port disagree'
	);
	return url.origin;
}
