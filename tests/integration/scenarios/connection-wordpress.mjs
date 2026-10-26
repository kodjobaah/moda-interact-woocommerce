import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

export async function assertConnectionWordPress({
	siteUrl,
	auth,
	fetchWordPress,
	request,
	merchantBootstrapRequest,
}) {
	const noAuth = await fetchWordPress(
		`${siteUrl}/wp-json/moda-interact/v1/connection`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		}
	);
	assert.ok(
		noAuth.status === 401 || noAuth.status === 403,
		`unauthenticated POST must be denied, got ${noAuth.status}`
	);
	const badNonce = await fetchWordPress(
		`${siteUrl}/wp-json/moda-interact/v1/connection`,
		{
			method: 'POST',
			headers: {
				Cookie: `${auth.cookieName}=${auth.cookie}`,
				'X-WP-Nonce': 'invalid',
				'content-type': 'application/json',
			},
			body: '{}',
		}
	);
	assert.ok(
		badNonce.status === 401 || badNonce.status === 403,
		`invalid REST nonce must be denied, got ${badNonce.status}`
	);
	const unknownChallenge = await fetchWordPress(
		`${siteUrl}/wp-json/moda-interact/v1/connection/challenge?attempt_id=550e8400-e29b-41d4-a716-446655440000&nonce=${randomBytes(32).toString('base64url')}`
	);
	assert.equal(unknownChallenge.status, 404);
	const browserIdentity = await request('', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			siteUrl: 'https://attacker.invalid',
			shopId: 'attacker',
		}),
	});
	assert.equal(browserIdentity.status, 400);

	const connectedResponse = await request('', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}',
	});
	const connected = await connectedResponse.json();
	assert.equal(
		connectedResponse.status,
		200,
		`connection failed: ${JSON.stringify(connected)}`
	);
	assert.equal(connected.status, 'CONNECTED');
	assert.equal(
		JSON.stringify(connected).includes(
			Buffer.alloc(32, 1).toString('base64url')
		),
		false
	);
	assert.equal(JSON.stringify(connected).includes('bootstrapSecret'), false);
	assert.deepEqual(await (await request('')).json(), {
		status: 'CONNECTED',
		installationId: 'install_wp_fixture',
		shopId: 'shop_wp_fixture',
		canonicalSiteUrl: siteUrl,
		credentialVersion: 1,
	});
	assert.deepEqual(await (await request('')).json(), {
		status: 'RECONNECT_REQUIRED',
	});
	assert.deepEqual(await (await request('')).json(), {
		status: 'REMOTE_UNAVAILABLE',
	});

	const reconnect = await request('', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}',
	});
	assert.equal(reconnect.status, 200);
	assert.equal((await reconnect.json()).credentialVersion, 2);
	assert.deepEqual(await (await request('')).json(), {
		status: 'CONNECTED',
		installationId: 'install_wp_fixture',
		shopId: 'shop_wp_fixture',
		canonicalSiteUrl: siteUrl,
		credentialVersion: 2,
	});

	const bootstrapResponse = await merchantBootstrapRequest('?_locale=user');
	const bootstrap = await bootstrapResponse.json();
	assert.equal(bootstrapResponse.status, 200);
	assert.match(
		bootstrapResponse.headers.get('cache-control') ?? '',
		/\bprivate\b/i
	);
	assert.match(
		bootstrapResponse.headers.get('cache-control') ?? '',
		/\bno-store\b/i
	);
	assert.equal(bootstrapResponse.headers.get('pragma'), 'no-cache');
	assert.deepEqual(Object.keys(bootstrap).sort(), [
		'internationalContext',
		'schemaVersion',
		'shop',
		'storeProfile',
	]);
	assert.equal(bootstrap.shop.onboardingCompleted, false);
	assert.equal(bootstrap.internationalContext.storeLocale, 'pt_BR');
	assert.equal(bootstrap.internationalContext.languageTag, null);
	assert.equal(bootstrap.storeProfile.pendingCategory.displayName, 'Apparel');
	assert.equal(
		JSON.stringify(bootstrap).includes(
			Buffer.alloc(32, 2).toString('base64url')
		),
		false
	);
	const rejectedBootstrap = await merchantBootstrapRequest();
	assert.equal(rejectedBootstrap.status, 401);
	assert.deepEqual(await rejectedBootstrap.json(), {
		error: 'RECONNECT_REQUIRED',
	});
	const outageBootstrap = await merchantBootstrapRequest();
	assert.equal(outageBootstrap.status, 503);
	assert.deepEqual(await outageBootstrap.json(), {
		error: 'REMOTE_UNAVAILABLE',
	});
	const invalidBootstrap = await merchantBootstrapRequest();
	assert.equal(invalidBootstrap.status, 502);
	assert.deepEqual(await invalidBootstrap.json(), {
		error: 'REMOTE_RESPONSE_INVALID',
	});
	const deniedBootstrap = await fetchWordPress(
		`${siteUrl}/wp-json/moda-interact/v1/merchant/bootstrap`
	);
	assert.ok(deniedBootstrap.status === 401 || deniedBootstrap.status === 403);
	const badNonceBootstrap = await fetchWordPress(
		`${siteUrl}/wp-json/moda-interact/v1/merchant/bootstrap`,
		{
			headers: {
				Cookie: `${auth.cookieName}=${auth.cookie}`,
				'X-WP-Nonce': 'invalid',
			},
		}
	);
	assert.ok(
		badNonceBootstrap.status === 401 || badNonceBootstrap.status === 403
	);
}

export async function assertConnectionEnvironmentWordPress({
	request,
	apiOrigin,
	tlsFailureUrl,
	setApiBaseUrl,
	setWpHomeOverride,
	restoreWpHomeAndSiteUrl,
	restartPlugin,
	readStoredConnection,
}) {
	await setApiBaseUrl(tlsFailureUrl);
	assert.deepEqual(await (await request('')).json(), {
		status: 'REMOTE_UNAVAILABLE',
	});
	await setApiBaseUrl(apiOrigin);

	await setWpHomeOverride();
	const siteUrlChangedResponse = await request('', { redirect: 'manual' });
	assert.equal(
		siteUrlChangedResponse.status,
		200,
		`SITE_URL_CHANGED must return 200 without a redirect (received ${siteUrlChangedResponse.status}, Location: ${siteUrlChangedResponse.headers.get('location') ?? 'none'})`
	);
	assert.deepEqual(await siteUrlChangedResponse.json(), {
		status: 'SITE_URL_CHANGED',
	});
	await restoreWpHomeAndSiteUrl();

	await restartPlugin();
	assert.deepEqual(await readStoredConnection(), ['install_wp_fixture', 2]);
}
