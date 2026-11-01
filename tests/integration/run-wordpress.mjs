import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { mkdtemp, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertStoreContextWordPress } from './scenarios/store-context-assertions.mjs';
import { createWordPressFetch } from './wordpress-http.mjs';
import { assertStoreCategoryWordPress } from './scenarios/category-assertions.mjs';
import { assertLocaleWordPress } from './scenarios/locale-wordpress.mjs';
import { assertLocaleBatch010 } from './scenarios/locale-batch-010.mjs';
import { assertLocaleBatch011 } from './scenarios/locale-batch-011.mjs';
import { assertLocaleBatch012 } from './scenarios/locale-batch-012.mjs';
import { assertLocaleBatch013 } from './scenarios/locale-batch-013.mjs';
import { assertReleaseLocales } from './scenarios/release-locales.mjs';
import { assertCheckoutWordPress } from './scenarios/checkout-wordpress.mjs';
import { assertCheckoutConsentWordPress } from './scenarios/checkout-consent-wordpress.mjs';
import { assertBillingWordPress } from './scenarios/billing-wordpress.mjs';
import { siteUrlFromWpEnvStatus } from './wp-env-status.mjs';
import {
	readPendingCheckoutActions,
	readCheckoutActionHistory,
} from './action-scheduler-sql.mjs';
import { createWordPressApiFixture } from './wordpress-api-fixture.mjs';
import {
	assertInitialShopBrandWordPress,
	assertShopBrandWordPress,
} from './scenarios/shop-brand-wordpress.mjs';
import {
	assertConnectionEnvironmentWordPress,
	assertConnectionWordPress,
} from './scenarios/connection-wordpress.mjs';

const execFileAsync = promisify(execFile);
const checkoutOnly = process.argv.includes('--checkout-only');
const restoreOnly = process.argv.includes('--restore-only');
const consentOnly = process.argv.includes('--consent-only');
const consentBrowser = process.argv.includes('--consent-browser');
const shopBrandOnly = process.argv.includes('--shop-brand-only');
assert.ok(!(shopBrandOnly && (checkoutOnly || consentOnly)), 'Choose one focused WordPress integration mode');
assert.ok(!(restoreOnly && (checkoutOnly || consentOnly || shopBrandOnly)), 'Choose one focused WordPress integration mode');
const repository = resolve(import.meta.dirname, '../..');
const fixtureCaPath = join(repository, 'tests/integration/.fixture-ca.pem');
let siteUrl;
let wpEnvComposeFile;
const fetchWordPress = createWordPressFetch();
const temporaryDirectory = await mkdtemp(
	join(tmpdir(), 'moda-woo-api-fixture-')
);
const keyPath = join(temporaryDirectory, 'fixture-key.pem');
const certificatePath = join(temporaryDirectory, 'fixture-cert.pem');
let wordpressStarted = false;
let originalWpHome;
let wpHomeOverrideApplied = false;
let originalSiteLocale;
let siteLocaleOverrideApplied = false;

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
			env: process.env,
		}
	);
}

// The HTTPS fixture runs in this process. Delivery-triggering WP-CLI commands
// must be asynchronous so the fixture can accept and respond to PHP requests.
async function wpAsync(...args) {
	const { stdout } = await execFileAsync(
		'npm',
		['exec', '--', 'wp-env', 'run', 'cli', 'wp', ...args],
		{
			cwd: repository,
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
			env: process.env,
		}
	);
	return stdout;
}

function runningWordPressSite() {
	const output = command('npm', ['exec', '--', 'wp-env', 'status', '--json']);
	let status;
	try {
		status = JSON.parse(output.trim());
	} catch {
		throw new Error('wp-env status --json did not return valid JSON');
	}
	const resolvedUrl = siteUrlFromWpEnvStatus(status);
	assert.equal(
		typeof status.installPath,
		'string',
		'wp-env status did not report its install path'
	);
	wpEnvComposeFile = join(status.installPath, 'docker-compose.yml');
	process.stdout.write(`[ARCH035] Using running wp-env: ${resolvedUrl}\n`);
	return resolvedUrl;
}

function restoreWpHome() {
	const args =
		originalWpHome === null
			? ['delete', 'WP_HOME']
			: ['set', 'WP_HOME', originalWpHome, '--type=constant'];
	command(
		'npm',
		['exec', '--', 'wp-env', 'run', 'cli', 'wp', 'config', ...args],
		{
			env: process.env,
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

const apiFixture = createWordPressApiFixture({
	fetchWordPress,
	getSiteUrl: () => siteUrl,
});

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
			const handled = await apiFixture.handleRequest({
				url,
				request,
				response,
				bodyBytes,
				sendJson,
			});
			if (!handled) {
				sendJson(response, 404, { error: 'not_found' });
			}
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
	if (checkoutOnly || restoreOnly || consentOnly) {
		// Never start, stop, activate or reset a developer's existing wp-env.
		// The checkout assertions create test orders/users and alter WooCommerce settings.
		assert.equal(
			process.env.MODA_CHECKOUT_TEST_DISPOSABLE,
			'1',
			'--checkout-only / --consent-only change WooCommerce test data. Set MODA_CHECKOUT_TEST_DISPOSABLE=1 only for a disposable wp-env site.'
		);
		siteUrl = runningWordPressSite();
		const response = await fetchWordPress(siteUrl);
		assert.ok(
			response.status < 500,
			`Existing WordPress site is unhealthy (HTTP ${response.status})`
		);
		const state = parseJsonOutput(
			wp(
				'eval',
				`
			$connection = get_option('moda_interact_woocommerce_connection');
			echo wp_json_encode(array(
				'moda' => defined('MODA_INTERACT_MAIN_PLUGIN_FILE') && is_plugin_active(plugin_basename(MODA_INTERACT_MAIN_PLUGIN_FILE)),
				'woo' => class_exists('WooCommerce'),
				'installationId' => is_array($connection) ? ($connection['installationId'] ?? null) : null,
				'credentialVersion' => is_array($connection) ? ($connection['credentialVersion'] ?? null) : null,
			));
		`
			)
		);
		assert.ok(
			state.moda && state.woo,
			'Existing wp-env must have WooCommerce and Moda active'
		);
		assert.equal(
			state.installationId,
			'install_wp_fixture',
			'Checkout-only requires the existing isolated Moda integration connection fixture'
		);
		assert.equal(
			Number(state.credentialVersion),
			2,
			'Checkout-only requires the existing integration fixture credential version 2'
		);
		const previous = parseJsonOutput(
			wp(
				'eval',
				`
			echo wp_json_encode(array(
				'base' => defined('MODA_INTERACT_API_BASE_URL') ? MODA_INTERACT_API_BASE_URL : null,
				'ca' => defined('MODA_INTERACT_API_CA_BUNDLE') ? MODA_INTERACT_API_CA_BUNDLE : null,
				'mode' => defined('MODA_INTERACT_CONNECTION_MODE') ? MODA_INTERACT_CONNECTION_MODE : null,
			));
		`
			)
		);
		const constants = [
			['MODA_INTERACT_API_BASE_URL', apiOrigin, previous.base],
			[
				'MODA_INTERACT_API_CA_BUNDLE',
				parseJsonOutput(
					wp(
						'eval',
						'echo wp_json_encode(dirname(MODA_INTERACT_MAIN_PLUGIN_FILE));'
					)
				) + '/tests/integration/.fixture-ca.pem',
				previous.ca,
			],
			[
				'MODA_INTERACT_CONNECTION_MODE',
				'local-development',
				previous.mode,
			],
		];
		const applied = [];
		try {
			for (const [name, value, prior] of constants) {
				// Refuse to overwrite existing unrelated API configuration.
				assert.ok(
					prior === null || typeof prior === 'string',
					`${name}: unexpected existing configuration`
				);
				wp('config', 'set', name, value, '--type=constant');
				applied.push([name, prior]);
			}
			if (consentOnly) {
				await assertCheckoutConsentWordPress({
					siteUrl,
					wp,
					parseJsonOutput,
					fixture: apiFixture,
					getCheckoutActionHistory: () =>
						readCheckoutActionHistory(wpEnvComposeFile),
					withBrowser: consentBrowser,
				});
			} else {
				await assertCheckoutWordPress({
					siteUrl,
					wp,
					wpAsync,
					parseJsonOutput,
					getPendingCheckoutActions: () =>
						readPendingCheckoutActions(wpEnvComposeFile),
					getCheckoutActionHistory: () =>
						readCheckoutActionHistory(wpEnvComposeFile),
					getActivityRequests: apiFixture.getActivityRequests,
					setActivityStatus: apiFixture.setActivityStatus,
					getRestoreResolveRequests: apiFixture.getRestoreResolveRequests,
					setRestoreResolveResult: apiFixture.setRestoreResolveResult,
					restoreOnly,
				});
			}
			process.stdout.write(
				consentOnly
					? 'ARCH-046 consent-only integration PASS\n'
					: restoreOnly
						? 'ARCH-053 restore-only integration PASS\n'
						: 'ARCH-035 checkout-only integration PASS\n'
			);
		} finally {
			for (const [name, prior] of applied.reverse()) {
				try {
					if (prior === null) {
						wp('config', 'delete', name);
					} else {
						wp('config', 'set', name, prior, '--type=constant');
					}
				} catch (error) {
					process.stderr.write(
						`Could not restore ${name}: ${error.message}\n`
					);
				}
			}
		}
	} else {
		// wp-env mounts this checkout; classmap-authoritative Composer autoloading
		// must include newly added PHP REST controllers before WordPress boots.
		command('composer', [
			'dump-autoload',
			'--optimize',
			'--classmap-authoritative',
		]);
		wordpressStarted = true;
		command('npm', ['run', 'env:start'], {
			env: process.env,
		});
		siteUrl = runningWordPressSite();
		const originalSiteConfiguration = parseJsonOutput(
			wp(
				'eval',
				'echo wp_json_encode(array("wpHome" => defined("WP_HOME") ? WP_HOME : null, "siteLocale" => get_option("WPLANG", null)));'
			)
		);
		originalWpHome = originalSiteConfiguration.wpHome;
		assert.ok(
			originalWpHome === null || typeof originalWpHome === 'string',
			'initial WP_HOME must be a string or undefined'
		);
		// The administrator's locale does not configure the WordPress site locale.
		// A fresh wp-env installation otherwise defaults to en_US.
		originalSiteLocale = originalSiteConfiguration.siteLocale;
		assert.ok(
			originalSiteLocale === null ||
				typeof originalSiteLocale === 'string',
			'initial site locale must be a string or absent'
		);
		wp('language', 'core', 'install', 'en_GB');
		siteLocaleOverrideApplied = true;
		wp('site', 'switch-language', 'en_GB');
		assert.equal(
			parseJsonOutput(wp('eval', 'echo wp_json_encode(get_locale());')),
			'en_GB',
			'WordPress must use en_GB before store-context assertions'
		);
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
				`update_option("home", "${siteUrl}"); update_option("siteurl", "${siteUrl}"); update_option("permalink_structure", "/%postname%/");`,
			],
			{ env: process.env }
		);
		const plugins = parseJsonOutput(wp('plugin', 'list', '--format=json'));
		const plugin = plugins.find(
			(entry) => entry.name === basename(repository)
		);
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
			{ env: process.env }
		);
		const pluginDir = parseJsonOutput(
			wp(
				'eval',
				'echo wp_json_encode(dirname(MODA_INTERACT_MAIN_PLUGIN_FILE));'
			)
		);
		// WordPress gettext and the bundled script must honor the administrator's
		// UI locale without rewriting the site/store language.
		assertLocaleWordPress({ wp, parseJsonOutput, repository });
		assertLocaleBatch010({ wp, parseJsonOutput, repository });
		assertLocaleBatch011({ wp, parseJsonOutput, repository });
		assertLocaleBatch012({ wp, parseJsonOutput, repository });
		assertLocaleBatch013({ wp, parseJsonOutput, repository });
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
			{ env: process.env }
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
			{ env: process.env }
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
			{ env: process.env }
		);
		const auth = parseJsonOutput(
			wp(
				'eval',
				'$user_id = 1; $expiration = time() + DAY_IN_SECONDS; $token = WP_Session_Tokens::get_instance($user_id)->create($expiration); $cookie = wp_generate_auth_cookie($user_id, $expiration, "logged_in", $token); $_COOKIE[LOGGED_IN_COOKIE] = $cookie; wp_set_current_user($user_id); echo wp_json_encode(array("cookieName" => LOGGED_IN_COOKIE, "cookie" => $cookie, "nonce" => wp_create_nonce("wp_rest")));'
			)
		);
		const request = (path, options = {}) =>
			fetchWordPress(
				`${siteUrl}/wp-json/moda-interact/v1/connection${path}`,
				{
					...options,
					headers: {
						...(options.headers ?? {}),
						Cookie: `${auth.cookieName}=${auth.cookie}`,
						'X-WP-Nonce': auth.nonce,
					},
				}
			);
		const merchantBootstrapRequest = (query = '') =>
			fetchWordPress(
				`${siteUrl}/wp-json/moda-interact/v1/merchant/bootstrap${query}`,
				{
					headers: {
						Cookie: `${auth.cookieName}=${auth.cookie}`,
						'X-WP-Nonce': auth.nonce,
					},
				}
			);

		// wp-env persists its WordPress database across runs. A previous successful
		// ShopBrand scenario retains the one-time bootstrap marker for the fixed
		// fixture installation ID, and reconnecting that same installation must
		// NOT enqueue another initial capture. Reset only owned fixture state
		// before the connection scenario so reruns still exercise first connect.
		const brandFixtureReset = parseJsonOutput(await wpAsync('eval', `
			$record = get_option('moda_interact_woocommerce_connection', null);
			if (null !== $record && (!is_array($record) ||
				($record['installationId'] ?? null) !== 'install_wp_fixture' ||
				($record['shopId'] ?? null) !== 'shop_wp_fixture')) {
				throw new RuntimeException('Refusing to reset a non-fixture Moda connection');
			}
			$marker = get_option('moda_interact_shop_brand_bootstrapped_installation', '');
			if ($marker !== '' && $marker !== 'install_wp_fixture') {
				throw new RuntimeException('Refusing to reset a non-fixture ShopBrand marker');
			}
			$cleared = 0;
			foreach (array('moda_interact_capture_woo_shop_brand', 'moda_interact_publish_woo_shop_brand') as $hook) {
				$actions = as_get_scheduled_actions(array(
					'hook' => $hook, 'group' => 'moda-interact-shop-brand',
					'status' => 'pending', 'per_page' => 100,
				));
				foreach ($actions as $action) {
					$args = array_values($action->get_args());
					$is_capture = $hook === 'moda_interact_capture_woo_shop_brand';
					$installation = $args[$is_capture ? 0 : 1] ?? null;
					$shop = $args[$is_capture ? 1 : 2] ?? null;
					if ($installation !== 'install_wp_fixture' || $shop !== 'shop_wp_fixture') {
						throw new RuntimeException('Refusing to cancel a non-fixture ShopBrand action');
					}
					as_unschedule_all_actions($hook, $args, 'moda-interact-shop-brand');
					++$cleared;
				}
			}
			delete_option('moda_interact_woocommerce_connection');
			delete_option('moda_interact_shop_brand_bootstrapped_installation');
			echo wp_json_encode(array(
				'connectionCleared' => get_option('moda_interact_woocommerce_connection', null) === null,
				'markerCleared' => get_option('moda_interact_shop_brand_bootstrapped_installation', '') === '',
				'pendingActionsCleared' => $cleared,
			));
		`));
		assert.equal(brandFixtureReset.connectionCleared, true);
		assert.equal(brandFixtureReset.markerCleared, true);
		await assertConnectionWordPress({
			siteUrl,
			auth,
			fetchWordPress,
			request,
			merchantBootstrapRequest,
			onInitialConnection: () => assertInitialShopBrandWordPress({
				wpAsync,
				parseJsonOutput,
				fixture: apiFixture,
			}),
		});
		await assertShopBrandWordPress({
			wpAsync,
			parseJsonOutput,
			fixture: apiFixture,
			siteUrl,
			auth,
			fetchWordPress,
		});
		if (!shopBrandOnly) {
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
				{ env: process.env }
			);
			await assertBillingWordPress({
				siteUrl,
				auth,
				fetchWordPress,
				fixture: apiFixture,
			});
			for (let index = 0; index < 3; index += 1) {
				assert.deepEqual(await (await request('')).json(), {
					status: 'REMOTE_UNAVAILABLE',
				});
			}
			assert.deepEqual(await (await request('')).json(), {
				status: 'REMOTE_UNAVAILABLE',
			});

			await assertConnectionEnvironmentWordPress({
				request,
				apiOrigin,
				tlsFailureUrl: `https://${hostBridgeIp}:${apiPort}`,
				setApiBaseUrl: (url) =>
					wp(
						'config',
						'set',
						'MODA_INTERACT_API_BASE_URL',
						url,
						'--type=constant'
					),
				setWpHomeOverride: () => {
					wpHomeOverrideApplied = true;
					wp(
						'config',
						'set',
						'WP_HOME',
						'http://new-site.local',
						'--type=constant'
					);
				},
				restoreWpHomeAndSiteUrl: () => {
					restoreWpHome();
					wpHomeOverrideApplied = false;
					wp('eval', `update_option("home", "${siteUrl}");`);
				},
				restartPlugin: () => {
					wp('plugin', 'deactivate', plugin.name);
					wp('plugin', 'activate', plugin.name);
				},
				readStoredConnection: () =>
					parseJsonOutput(
						wp(
							'eval',
							'echo wp_json_encode(array(get_option("moda_interact_woocommerce_connection")["installationId"], get_option("moda_interact_woocommerce_connection")["credentialVersion"]));'
						)
					),
			});
			await assertCheckoutWordPress({
				siteUrl,
				wp,
				wpAsync,
				parseJsonOutput,
				getPendingCheckoutActions: () =>
					readPendingCheckoutActions(wpEnvComposeFile),
				getCheckoutActionHistory: () =>
					readCheckoutActionHistory(wpEnvComposeFile),
				getActivityRequests: apiFixture.getActivityRequests,
				setActivityStatus: apiFixture.setActivityStatus,
				getRestoreResolveRequests: apiFixture.getRestoreResolveRequests,
				setRestoreResolveResult: apiFixture.setRestoreResolveResult,
			});
			await assertCheckoutConsentWordPress({
				siteUrl,
				wp,
				parseJsonOutput,
				fixture: apiFixture,
				getCheckoutActionHistory: () =>
					readCheckoutActionHistory(wpEnvComposeFile),
				withBrowser: consentBrowser,
			});
			await assertStoreContextWordPress({
				siteUrl,
				auth,
				wp,
				parseJsonOutput,
				getFixtureState: () => ({
					attempts: apiFixture.getState().contextSyncAttempts,
					saved: apiFixture.getState().savedContext,
				}),
			});
			await assertStoreCategoryWordPress({
				siteUrl,
				auth,
				wp,
				parseJsonOutput,
				getCategoryState: () => {
					const state = apiFixture.getState();
					return {
						selections: state.categorySelections,
						generation: state.categoryGeneration,
					};
				},
			});
			assertReleaseLocales({
				wpEval: (source) => wp('eval', source),
				parseJsonOutput,
				getRemoteState: apiFixture.getState,
			});
			process.stdout.write(
				'WOO-014 installed plugin 20-language PHP/JS and Shop-state checks passed.\n'
			);
			process.stdout.write(
				'WOO-008 WordPress category selection + active readback integration passed.\n'
			);
			process.stdout.write(
				'WOO-007 WordPress store-context sync + readback integration passed.\n'
			);
			process.stdout.write(
				'WOO-003 WordPress REST + HTTPS fixture integration passed.\n'
			);
		}
		if (process.env.KEEP_WP_ENV === '1') {
			process.stdout.write(
				'KEEP_WP_ENV=1: integration fixture is ready for browser smoke; send SIGTERM to clean up.\n'
			);
			await new Promise((resolveSignal) =>
				process.once('SIGTERM', resolveSignal)
			);
		}
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
					{ env: process.env }
				);
			} catch {
				process.stderr.write(
					`Could not remove temporary ${constant} wp-env configuration.\n`
				);
			}
		}
		if (wpHomeOverrideApplied) {
			try {
				restoreWpHome();
			} catch {
				process.stderr.write(
					'Could not restore the original WP_HOME configuration.\n'
				);
			}
		}
		if (siteLocaleOverrideApplied) {
			try {
				if (originalSiteLocale === null) {
					wp('option', 'delete', 'WPLANG');
				} else {
					wp('option', 'update', 'WPLANG', originalSiteLocale);
				}
			} catch {
				process.stderr.write(
					'Could not restore the original WordPress site locale.\n'
				);
			}
		}
		try {
			command('npm', ['run', 'env:stop'], {
				env: process.env,
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
