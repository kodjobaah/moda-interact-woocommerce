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

/**
 * Consent-only tests reuse an already connected disposable installation. A
 * wp-env port change can leave its *persisted* canonical URL bound to the old
 * origin, which correctly suppresses the checkbox in production code. Diagnose
 * that mismatch before creating products or modifying checkout configuration.
 * Never rebind credentials or relax the runtime's site-identity validation.
 */
export function assertConsentFixtureSiteIdentity(siteUrl, identity) {
	const expected = new URL(siteUrl);
	assert.equal(expected.pathname, '/', 'Fixture must run at the local site root');
	const trim = (value) =>
		typeof value === 'string' ? value.replace(/\/+$/, '') : '';
	const expectedRoot = trim(expected.origin);

	assert.ok(
		trim(identity?.effectiveSiteUrl) === expectedRoot,
		'WordPress home_url does not match the running wp-env origin. The disposable site may retain configuration from an earlier port; restore its site URL using the full WordPress integration setup before running consent-only tests.'
	);
	assert.ok(
		trim(identity?.installationSiteUrl) === expectedRoot,
		'Stored Moda fixture installation is bound to another WordPress origin (for example a previous wp-env port). Reconnect the synthetic installation using the full disposable WordPress integration setup at the current port before running consent-only tests. Never bypass canonical-site authorization.'
	);
}
