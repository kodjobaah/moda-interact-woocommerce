import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import { mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '../..');
const fixtureCaPath = join(repository, 'tests/integration/.fixture-ca.pem');
const port = Number(process.env.WP_ENV_PORT ?? 8899);
const siteUrl = `http://localhost:${port}`;
const temporaryDirectory = await mkdtemp(
	join(tmpdir(), 'moda-woo-api-fixture-')
);
const keyPath = join(temporaryDirectory, 'fixture-key.pem');
const certificatePath = join(temporaryDirectory, 'fixture-cert.pem');
let probeCount = 0;
let connectCount = 0;
let bootstrapCount = 0;
let billingReadCount = 0;
let plansReadCount = 0;
let createCount = 0;
let switchCount = 0;
let cancelCount = 0;
let wordpressStarted = false;

function command(program, args, options = {}) {
	return execFileSync(program, args, {
		cwd: repository,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'inherit'],
		...options,
	});
}

function wp(...args) {
	return command(
		'npm',
		['exec', '--', 'wp-env', 'run', 'cli', 'wp', ...args],
		{
			env: { ...process.env, WP_ENV_PORT: String(port) },
		}
	);
}

function parseJsonOutput(output) {
	for (const line of output.trim().split('\n').reverse()) {
		const start = line.search(/[\[{\"]|(?:true|false|null|-?\d)/);
		if (start >= 0) {
			try {
				return JSON.parse(line.slice(start).trim());
			} catch {
				continue;
			}
		}
	}
	throw new Error('WP-CLI returned no JSON payload');
}

function sendJson(response, status, body) {
	if (response.destroyed) {
		return;
	}
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	});
	response.end(JSON.stringify(body));
}

function assertBillingAuthentication(request) {
	assert.equal(
		request.headers['x-moda-installation-id'],
		'install_wp_fixture'
	);
	assert.equal(
		request.headers.authorization,
		`Bearer ${Buffer.alloc(32, 2).toString('base64url')}`
	);
	assert.equal(request.headers.cookie, undefined);
}

function billingPresentationFixture() {
	return {
		schemaVersion: 1,
		experienceState: 'ACTIVE',
		surfaces: {
			usageHistoryAllowed: true,
			purchaseHistoryAllowed: true,
			managePlansAllowed: true,
			cancelSubscriptionAllowed: true,
		},
		currentPlan: {
			merchantPricingPlanId: 'plan_free',
			displayName: 'Free',
			planKind: 'FREE',
			recurringAmountMinor: 0,
			currency: 'USD',
			billingPeriod: 'EVERY_30_DAYS',
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			cancellationEffectiveAt: null,
		},
		pendingPlan: null,
		pendingCancellation: null,
		capacity: {
			paidIncluded: null,
			freeLifetime: {
				granted: 2,
				committed: 0,
				reserved: 0,
				remaining: 2,
			},
			promotional: {
				granted: 0,
				committed: 0,
				reserved: 0,
				remaining: 0,
			},
			purchased: {
				granted: 0,
				committed: 0,
				reserved: 0,
				refunding: 0,
				available: 0,
			},
		},
		topUps: {
			configured: false,
			purchaseEligible: false,
			offers: [],
			latestPurchase: null,
			unresolvedPurchases: [],
		},
	};
}

async function verifyChallenge(body) {
	assert.equal(typeof body.siteUrl, 'string');
	assert.match(
		body.attemptId,
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
	);
	assert.equal(Buffer.from(body.bootstrapSecret, 'base64url').length, 32);
	const nonce = randomBytes(32).toString('base64url');
	const callback = new URL(body.siteUrl);
	callback.pathname = `${callback.pathname.replace(/\/+$/, '')}/wp-json/moda-interact/v1/connection/challenge`;
	callback.search = new URLSearchParams({
		attempt_id: body.attemptId,
		nonce,
	}).toString();
	const response = await fetch(callback);
	assert.equal(
		response.status,
		200,
		'the real unauthenticated WordPress challenge route must answer'
	);
	assert.match(
		response.headers.get('content-type') ?? '',
		/^application\/json/i
	);
	const challenge = await response.json();
	assert.deepEqual(Object.keys(challenge).sort(), [
		'attemptId',
		'nonce',
		'proof',
	]);
	assert.equal(challenge.attemptId, body.attemptId);
	assert.equal(challenge.nonce, nonce);
	const expected = createHmac(
		'sha256',
		Buffer.from(body.bootstrapSecret, 'base64url')
	)
		.update(
			`moda-interact-connect-v1\n${body.attemptId}\n${nonce}\n${body.siteUrl}`,
			'utf8'
		)
		.digest('base64url');
	assert.equal(challenge.proof, expected);
}

command(
	'openssl',
	[
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-sha256',
		'-nodes',
		'-days',
		'2',
		'-keyout',
		keyPath,
		'-out',
		certificatePath,
		'-subj',
		'/CN=host.docker.internal',
		'-addext',
		'subjectAltName=DNS:host.docker.internal',
	],
	{ stdio: 'ignore' }
);
const certificate = await readFile(certificatePath);
await writeFile(fixtureCaPath, certificate);

const server = createServer(
	{ key: await readFile(keyPath), cert: certificate },
	async (request, response) => {
		try {
			const chunks = [];
			for await (const chunk of request) {
				chunks.push(chunk);
			}
			const bodyBytes = Buffer.concat(chunks);
			const url = new URL(request.url ?? '/', 'https://fixture.invalid');
			if (
				url.pathname === '/v1/woocommerce/installations/connect' &&
				request.method === 'POST'
			) {
				assert.equal(request.headers.authorization, undefined);
				assert.equal(request.headers.cookie, undefined);
				assert.ok(bodyBytes.length <= 8192);
				const body = JSON.parse(bodyBytes.toString('utf8'));
				assert.deepEqual(Object.keys(body).sort(), [
					'attemptId',
					'bootstrapSecret',
					'siteUrl',
				]);
				await verifyChallenge(body);
				connectCount += 1;
				const credential = Buffer.alloc(32, connectCount).toString(
					'base64url'
				);
				sendJson(response, connectCount === 1 ? 201 : 200, {
					installationId: 'install_wp_fixture',
					shopId: 'shop_wp_fixture',
					canonicalSiteUrl: body.siteUrl,
					credential,
					credentialVersion: connectCount,
					connection: connectCount === 1 ? 'CREATED' : 'RECONNECTED',
				});
				return;
			}
			if (
				url.pathname === '/v1/woocommerce/installation' &&
				request.method === 'GET'
			) {
				probeCount += 1;
				assert.equal(
					request.headers['x-moda-installation-id'],
					'install_wp_fixture'
				);
				assert.match(
					request.headers.authorization ?? '',
					/^Bearer [A-Za-z0-9_-]{43}$/
				);
				assert.equal(request.headers.cookie, undefined);
				if (probeCount === 1) {
					sendJson(response, 200, {
						installationId: 'install_wp_fixture',
						shopId: 'shop_wp_fixture',
						canonicalSiteUrl: siteUrl,
						credentialVersion: 1,
					});
				} else if (probeCount === 2) {
					sendJson(response, 401, { error: 'unauthorized' });
				} else if (probeCount === 3) {
					sendJson(response, 500, { error: 'internal_error' });
				} else if (probeCount === 4) {
					sendJson(response, 200, {
						installationId: 'install_wp_fixture',
						shopId: 'shop_wp_fixture',
						canonicalSiteUrl: siteUrl,
						credentialVersion: 2,
					});
				} else if (probeCount === 5) {
					response.writeHead(200, {
						'content-type': 'application/json',
					});
					response.end('{broken');
				} else if (probeCount === 6) {
					response.writeHead(200, {
						'content-type': 'application/json',
						'content-length': '8193',
					});
					response.end(`${' '.repeat(8193)}`);
				} else if (probeCount === 7) {
					response.writeHead(302, {
						location: 'https://elsewhere.invalid/',
					});
					response.end();
				} else if (probeCount === 8) {
					setTimeout(() => sendJson(response, 200, {}), 6500).unref();
				} else {
					sendJson(response, 200, {
						installationId: 'install_wp_fixture',
						shopId: 'shop_wp_fixture',
						canonicalSiteUrl: siteUrl,
						credentialVersion: 2,
					});
				}
				return;
			}
			if (
				url.pathname === '/v1/merchant/bootstrap' &&
				request.method === 'GET'
			) {
				bootstrapCount += 1;
				assert.equal(
					url.search,
					'',
					'the authenticated bootstrap request must not contain tenant selectors'
				);
				assert.equal(
					request.headers['x-moda-installation-id'],
					'install_wp_fixture'
				);
				assert.equal(
					request.headers.authorization,
					`Bearer ${Buffer.alloc(32, 2).toString('base64url')}`
				);
				assert.equal(request.headers.cookie, undefined);
				assert.equal(bodyBytes.length, 0);
				if (bootstrapCount === 1) {
					sendJson(response, 200, {
						schemaVersion: 1,
						shop: {
							id: 'shop_wp_fixture',
							platform: 'WOOCOMMERCE',
							domain: 'https://merchant.example',
							onboardingCompleted: false,
							installedAt: '2026-10-03T12:00:00.000Z',
						},
						internationalContext: {
							storeLocale: 'pt_BR',
							languageTag: null,
							timeZone: 'Europe/Lisbon',
							countryCode: 'PT',
						},
						storeProfile: {
							activeCategory: null,
							pendingCategory: {
								id: 'category_1',
								slug: 'apparel',
								displayName: 'Apparel',
							},
							pendingSelectionGeneration: 3,
							pendingSelectedAt: '2026-10-02T12:30:00Z',
						},
					});
				} else if (bootstrapCount === 2) {
					sendJson(response, 401, { error: 'unauthorized' });
				} else if (bootstrapCount === 3) {
					sendJson(response, 500, {
						error: 'private provider detail',
					});
				} else if (bootstrapCount === 4) {
					sendJson(response, 200, {
						schemaVersion: 999,
						private: 'must not be relayed',
					});
				} else {
					sendJson(response, 200, {
						schemaVersion: 1,
						shop: {
							id: 'shop_wp_fixture',
							platform: 'WOOCOMMERCE',
							domain: 'https://merchant.example',
							onboardingCompleted: false,
							installedAt: '2026-10-03T12:00:00.000Z',
						},
						internationalContext: {
							storeLocale: 'pt_BR',
							languageTag: null,
							timeZone: 'Europe/Lisbon',
							countryCode: 'PT',
						},
						storeProfile: {
							activeCategory: null,
							pendingCategory: {
								id: 'category_1',
								slug: 'apparel',
								displayName: 'Apparel',
							},
							pendingSelectionGeneration: 3,
							pendingSelectedAt: '2026-10-02T12:30:00Z',
						},
					});
				}
				return;
			}
			if (url.pathname === '/v1/billing' && request.method === 'GET') {
				assertBillingAuthentication(request);
				assert.equal(url.search, '');
				billingReadCount += 1;
				sendJson(response, 200, billingPresentationFixture());
				return;
			}
			if (
				url.pathname === '/v1/billing/plans' &&
				request.method === 'GET'
			) {
				assertBillingAuthentication(request);
				assert.equal(url.search, '?locale=en-GB');
				plansReadCount += 1;
				sendJson(response, 200, {
					schemaVersion: 1,
					resolvedLocale: 'en-GB',
					plans: [
						{
							merchantPricingPlanId: 'plan_paid',
							displayName: 'Growth',
							planKind: 'PAID_METERED',
							cataloguePosition: 1,
							featured: true,
							localizedDescription: 'Growth plan',
							includedRecoveryCredits: 10,
							allowancePeriod: 'EVERY_30_DAYS',
							billingPeriod: 'EVERY_30_DAYS',
							recurringAmountMinor: 4900,
							currency: 'USD',
							highlights: [],
						},
					],
				});
				return;
			}
			if (
				url.pathname === '/v1/billing/subscription' &&
				request.method === 'POST'
			) {
				assertBillingAuthentication(request);
				assert.match(
					request.headers['idempotency-key'] ?? '',
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
				);
				assert.deepEqual(Object.keys(JSON.parse(bodyBytes)).sort(), [
					'merchantPricingPlanId',
				]);
				createCount += 1;
				sendJson(response, 202, {
					schemaVersion: 1,
					operationId: 'operation_create',
					kind: 'SUBSCRIPTION_CREATE',
					state: 'AWAITING_CONFIRMATION',
					confirmationUrl: 'https://woocommerce.com/confirm/create',
				});
				return;
			}
			if (
				url.pathname === '/v1/billing/subscription/switch' &&
				request.method === 'POST'
			) {
				assertBillingAuthentication(request);
				assert.match(
					request.headers['idempotency-key'] ?? '',
					/^[0-9a-f-]{36}$/i
				);
				assert.deepEqual(Object.keys(JSON.parse(bodyBytes)).sort(), [
					'merchantPricingPlanId',
				]);
				switchCount += 1;
				sendJson(response, 202, {
					schemaVersion: 1,
					operationId: 'operation_switch',
					kind: 'PLAN_SWITCH',
					state: 'AWAITING_CONFIRMATION',
					confirmationUrl:
						'https://sandbox.woocommerce.com/confirm/switch',
				});
				return;
			}
			if (
				url.pathname === '/v1/billing/subscription' &&
				request.method === 'DELETE'
			) {
				assertBillingAuthentication(request);
				assert.match(
					request.headers['idempotency-key'] ?? '',
					/^[0-9a-f-]{36}$/i
				);
				assert.equal(bodyBytes.length, 0);
				cancelCount += 1;
				sendJson(response, 200, {
					schemaVersion: 1,
					operationId: 'operation_cancel',
					kind: 'CANCEL',
					state: 'CONFIRMED',
					confirmationUrl: null,
				});
				return;
			}
			sendJson(response, 404, { error: 'not_found' });
		} catch {
			sendJson(response, 500, { error: 'fixture_failure' });
		}
	}
);

await new Promise((resolveListen, rejectListen) => {
	server.once('error', rejectListen);
	server.listen(0, '0.0.0.0', resolveListen);
});
const apiPort = server.address().port;
const apiOrigin = `https://host.docker.internal:${apiPort}`;

try {
	wordpressStarted = true;
	command('npm', ['run', 'env:start'], {
		env: { ...process.env, WP_ENV_PORT: String(port) },
	});
	const hostBridgeIp = parseJsonOutput(
		wp(
			'eval',
			'echo wp_json_encode(gethostbyname("host.docker.internal"));'
		)
	);
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'eval',
			`update_option("home", "${siteUrl}"); update_option("siteurl", "${siteUrl}");`,
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'eval',
			'update_option("permalink_structure", "/%postname%/");',
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	const plugins = parseJsonOutput(wp('plugin', 'list', '--format=json'));
	const plugin = plugins.find((entry) => entry.name === basename(repository));
	assert.ok(plugin, 'wp-env must mount the Moda plugin');
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'plugin',
			'activate',
			'woocommerce',
			plugin.name,
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	const pluginDir = parseJsonOutput(
		wp(
			'eval',
			'echo wp_json_encode(dirname(MODA_INTERACT_MAIN_PLUGIN_FILE));'
		)
	);
	const caPathInContainer = `${pluginDir}/tests/integration/.fixture-ca.pem`;
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'config',
			'set',
			'MODA_INTERACT_API_BASE_URL',
			apiOrigin,
			'--type=constant',
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'config',
			'set',
			'MODA_INTERACT_API_CA_BUNDLE',
			caPathInContainer,
			'--type=constant',
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'config',
			'set',
			'MODA_INTERACT_CONNECTION_MODE',
			'local-development',
			'--type=constant',
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	const auth = parseJsonOutput(
		wp(
			'eval',
			'$user_id = 1; $expiration = time() + DAY_IN_SECONDS; $token = WP_Session_Tokens::get_instance($user_id)->create($expiration); $cookie = wp_generate_auth_cookie($user_id, $expiration, "logged_in", $token); $_COOKIE[LOGGED_IN_COOKIE] = $cookie; wp_set_current_user($user_id); echo wp_json_encode(array("cookieName" => LOGGED_IN_COOKIE, "cookie" => $cookie, "nonce" => wp_create_nonce("wp_rest")));'
		)
	);
	const request = (path, options = {}) =>
		fetch(`${siteUrl}/wp-json/moda-interact/v1/connection${path}`, {
			...options,
			headers: {
				...(options.headers ?? {}),
				Cookie: `${auth.cookieName}=${auth.cookie}`,
				'X-WP-Nonce': auth.nonce,
			},
		});
	const merchantBootstrapRequest = (query = '') =>
		fetch(
			`${siteUrl}/wp-json/moda-interact/v1/merchant/bootstrap${query}`,
			{
				headers: {
					Cookie: `${auth.cookieName}=${auth.cookie}`,
					'X-WP-Nonce': auth.nonce,
				},
			}
		);
	const billingRequest = (path, options = {}) =>
		fetch(`${siteUrl}/wp-json/moda-interact/v1/billing${path}`, {
			...options,
			headers: {
				...(options.headers ?? {}),
				Cookie: `${auth.cookieName}=${auth.cookie}`,
				'X-WP-Nonce': auth.nonce,
			},
		});

	const noAuth = await fetch(
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
	const badNonce = await fetch(
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
	const unknownChallenge = await fetch(
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
	const deniedBootstrap = await fetch(
		`${siteUrl}/wp-json/moda-interact/v1/merchant/bootstrap`
	);
	assert.ok(deniedBootstrap.status === 401 || deniedBootstrap.status === 403);
	const badNonceBootstrap = await fetch(
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
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'eval',
			'update_user_meta(1, "locale", "en_GB");',
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	const billingRoutes = [
		{ path: '', method: 'GET' },
		{ path: '/plans', method: 'GET' },
		{ path: '/subscription', method: 'POST' },
		{ path: '/subscription/switch', method: 'POST' },
		{ path: '/subscription/cancel', method: 'POST' },
	];
	const commandBody = {
		'/subscription': {
			merchantPricingPlanId: 'plan_paid',
			actionId: '550e8400-e29b-41d4-a716-446655440001',
		},
		'/subscription/switch': {
			merchantPricingPlanId: 'plan_paid',
			actionId: '550e8400-e29b-41d4-a716-446655440002',
		},
		'/subscription/cancel': {
			actionId: '550e8400-e29b-41d4-a716-446655440003',
		},
	};
	for (const route of billingRoutes) {
		const denied = await fetch(
			`${siteUrl}/wp-json/moda-interact/v1/billing${route.path}`,
			{ method: route.method }
		);
		assert.ok(
			denied.status === 401 || denied.status === 403,
			`unauthenticated billing ${route.method} ${route.path} must be denied`
		);
		const badNonceResponse = await fetch(
			`${siteUrl}/wp-json/moda-interact/v1/billing${route.path}`,
			{
				method: route.method,
				headers: {
					Cookie: `${auth.cookieName}=${auth.cookie}`,
					'X-WP-Nonce': 'invalid',
					'content-type': 'application/json',
				},
				...(commandBody[route.path]
					? { body: JSON.stringify(commandBody[route.path]) }
					: {}),
			}
		);
		assert.ok(
			badNonceResponse.status === 401 || badNonceResponse.status === 403,
			`invalid nonce billing ${route.method} ${route.path} must be denied`
		);
	}
	const billingResponse = await billingRequest('');
	assert.equal(billingResponse.status, 200);
	assert.match(
		billingResponse.headers.get('cache-control') ?? '',
		/\bprivate\b/i
	);
	assert.match(
		billingResponse.headers.get('cache-control') ?? '',
		/\bno-store\b/i
	);
	assert.equal((await billingResponse.json()).currentPlan.planKind, 'FREE');
	const plansResponse = await billingRequest('/plans');
	assert.equal(plansResponse.status, 200);
	assert.equal((await plansResponse.json()).resolvedLocale, 'en-GB');
	for (const path of ['/subscription', '/subscription/switch']) {
		const response = await billingRequest(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(commandBody[path]),
		});
		assert.equal(response.status, 200);
		const result = await response.json();
		assert.deepEqual(Object.keys(result).sort(), [
			'confirmationUrl',
			'operationId',
			'schemaVersion',
			'state',
		]);
		assert.equal(result.state, 'AWAITING_CONFIRMATION');
	}
	const cancellationResponse = await billingRequest('/subscription/cancel', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(commandBody['/subscription/cancel']),
	});
	assert.equal(cancellationResponse.status, 200);
	assert.deepEqual(await cancellationResponse.json(), {
		schemaVersion: 1,
		operationId: 'operation_cancel',
		state: 'CONFIRMED',
		confirmationUrl: null,
	});
	assert.deepEqual(
		[
			billingReadCount,
			plansReadCount,
			createCount,
			switchCount,
			cancelCount,
		],
		[1, 1, 1, 1, 1]
	);
	for (let index = 0; index < 3; index += 1) {
		assert.deepEqual(await (await request('')).json(), {
			status: 'REMOTE_UNAVAILABLE',
		});
	}
	assert.deepEqual(await (await request('')).json(), {
		status: 'REMOTE_UNAVAILABLE',
	});

	const tlsFailureUrl = `https://${hostBridgeIp}:${apiPort}`;
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'config',
			'set',
			'MODA_INTERACT_API_BASE_URL',
			tlsFailureUrl,
			'--type=constant',
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	assert.deepEqual(await (await request('')).json(), {
		status: 'REMOTE_UNAVAILABLE',
	});
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'config',
			'set',
			'MODA_INTERACT_API_BASE_URL',
			apiOrigin,
			'--type=constant',
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);

	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'config',
			'set',
			'WP_HOME',
			'http://new-site.local',
			'--type=constant',
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	assert.deepEqual(await (await request('')).json(), {
		status: 'SITE_URL_CHANGED',
	});
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'config',
			'delete',
			'WP_HOME',
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'eval',
			`update_option("home", "${siteUrl}");`,
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'plugin',
			'deactivate',
			plugin.name,
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	command(
		'npm',
		[
			'exec',
			'--',
			'wp-env',
			'run',
			'cli',
			'wp',
			'plugin',
			'activate',
			plugin.name,
		],
		{ env: { ...process.env, WP_ENV_PORT: String(port) } }
	);
	const stored = parseJsonOutput(
		wp(
			'eval',
			'echo wp_json_encode(array(get_option("moda_interact_woocommerce_connection")["installationId"], get_option("moda_interact_woocommerce_connection")["credentialVersion"]));'
		)
	);
	assert.deepEqual(stored, ['install_wp_fixture', 2]);
	process.stdout.write(
		'WOO-003 WordPress REST + HTTPS fixture integration passed.\n'
	);
	if (process.env.KEEP_WP_ENV === '1') {
		process.stdout.write(
			'KEEP_WP_ENV=1: integration fixture is ready for browser smoke; send SIGTERM to clean up.\n'
		);
		await new Promise((resolveSignal) =>
			process.once('SIGTERM', resolveSignal)
		);
	}
} finally {
	server.closeAllConnections();
	await new Promise((resolveClose) => server.close(() => resolveClose()));
	if (wordpressStarted) {
		for (const constant of [
			'MODA_INTERACT_API_BASE_URL',
			'MODA_INTERACT_CONNECTION_MODE',
			'MODA_INTERACT_API_CA_BUNDLE',
		]) {
			try {
				command(
					'npm',
					[
						'exec',
						'--',
						'wp-env',
						'run',
						'cli',
						'wp',
						'config',
						'delete',
						constant,
					],
					{ env: { ...process.env, WP_ENV_PORT: String(port) } }
				);
			} catch {
				process.stderr.write(
					`Could not remove temporary ${constant} wp-env configuration.\n`
				);
			}
		}
		try {
			const wpHome = wp(
				'eval',
				'echo defined("WP_HOME") ? WP_HOME : "";'
			).trim();
			if (wpHome) {
				command(
					'npm',
					[
						'exec',
						'--',
						'wp-env',
						'run',
						'cli',
						'wp',
						'config',
						'delete',
						'WP_HOME',
					],
					{ env: { ...process.env, WP_ENV_PORT: String(port) } }
				);
			}
		} catch {
			process.stderr.write(
				'Could not verify temporary WP_HOME configuration cleanup.\n'
			);
		}
		try {
			command('npm', ['run', 'env:stop'], {
				env: { ...process.env, WP_ENV_PORT: String(port) },
			});
		} catch {
			process.stderr.write(
				'wp-env stop failed; the environment may require manual cleanup.\n'
			);
		}
	}
	await unlink(fixtureCaPath).catch(() => undefined);
	await rm(temporaryDirectory, { recursive: true, force: true });
}
