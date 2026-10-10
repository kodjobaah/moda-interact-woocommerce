import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { availableWpEnvHostPort } from './wp-env-host-port.mjs';
import { assertReleaseLocales } from './release-locales.mjs';
import { assertReleaseBrowserLocales } from './release-browser-locales.mjs';

const repository = resolve(import.meta.dirname, '../..');
const baselineCommit = '98273e4ebdfa9a78146cb897fb905ef97a6814e7';
const temporaryDirectory = await mkdtemp(
	join(tmpdir(), 'moda-woo-package-lifecycle-')
);
const stagingDirectory = resolve(
	repository,
	`.package-lifecycle-${process.pid}`
);
const wpEnvProjectDirectory = join(temporaryDirectory, 'wp-env-project');
const artifactDirectory = join(stagingDirectory, 'artifacts');
const muPluginDirectory = join(stagingDirectory, 'mu-plugins');
const baselineDirectory = join(temporaryDirectory, 'woo-005-baseline');
const candidateArchive = resolve(repository, 'moda-interact.zip');
const baselineArchiveInArtifacts = join(
	artifactDirectory,
	'woo-005-baseline.zip'
);
const stagedCandidateArchive = join(artifactDirectory, 'moda-interact.zip');
const wpEnvCli = resolve(repository, 'node_modules/.bin/wp-env');
const syntheticCredential = Buffer.from(
	'4f91e0a8d3c6b27590f3a1c8e47d2b6a1c9e5f8037b4d261a5e8c39f7026bd14',
	'hex'
).toString('base64url');
const adminRenderToken = randomBytes(32).toString('base64url');
const fixture = {
	schemaVersion: 1,
	installationId: 'install_w006_synthetic_upgrade_fixture',
	shopId: 'shop_w006_synthetic_upgrade_fixture',
	canonicalSiteUrl: 'https://merchant-w006-fixture.invalid',
	credential: syntheticCredential,
	credentialVersion: 7,
	connectedAt: '2026-10-08T12:00:00+00:00',
};
const externalGuard = `<?php
add_action('init', static function () {
	if (
		!isset($_GET['moda_w006_test_login']) ||
		!hash_equals('${adminRenderToken}', (string) $_GET['moda_w006_test_login'])
	) {
		return;
	}
	wp_set_current_user(1);
	wp_set_auth_cookie(1, false, is_ssl());
	wp_safe_redirect(admin_url('admin.php?page=wc-admin&path=%2Fmoda-interact'));
	exit;
}, 0);

add_filter('pre_http_request', static function ($response, $arguments, $url) {
	if ('https://downloads.wordpress.org/plugin/moda-interact-w006-test.zip' === $url) {
		$archive = get_option('moda_w006_package_test_archive', '');
		if (!is_readable($archive)) {
			return new WP_Error('moda_w006_archive_missing', 'The staged package archive is unavailable.');
		}
		$destination = $arguments['filename'] ?? wp_tempnam($url);
		if (!copy($archive, $destination)) {
			return new WP_Error('moda_w006_archive_copy_failed', 'The staged package archive could not be copied.');
		}
		return array(
			'headers' => array('content-type' => 'application/zip'),
			'body' => '',
			'response' => array('code' => 200, 'message' => 'OK'),
			'cookies' => array(),
			'filename' => $destination,
		);
	}
	if ('api.modainteract.com' !== parse_url($url, PHP_URL_HOST)) {
		return $response;
	}
	$requests = get_option('moda_w006_package_test_api_requests', array());
	$requests[] = array('method' => $arguments['method'] ?? 'GET', 'path' => parse_url($url, PHP_URL_PATH));
	update_option('moda_w006_package_test_api_requests', $requests, false);
	return new WP_Error('moda_w006_test_block', 'Blocked by the WOO-006 package test network guard.');
}, 10, 3);
`;

await mkdir(artifactDirectory, { recursive: true });
await mkdir(stagingDirectory, { recursive: true });
await mkdir(wpEnvProjectDirectory, { recursive: true });
await mkdir(muPluginDirectory, { recursive: true });
await mkdir(baselineDirectory, { recursive: true });
await chmod(temporaryDirectory, 0o777);
await chmod(artifactDirectory, 0o777);
await chmod(muPluginDirectory, 0o777);
await writeFile(
	join(muPluginDirectory, 'moda-package-network-guard.php'),
	externalGuard
);

function capture(program, args, options = {}) {
	return execFileSync(program, args, {
		cwd: repository,
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
		...options,
	});
}

function run(program, args, cwd = repository, env = process.env) {
	const result = spawnSync(program, args, { cwd, env, stdio: 'inherit' });
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`${program} ${args.join(' ')} exited with ${result.status}`
		);
	}
}

function parseJsonOutput(output) {
	for (const line of output.trim().split('\n').reverse()) {
		const start = line.search(/[\[{"]|(?:true|false|null|-?\d)/);
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

function environmentConfig(name) {
	return resolve(wpEnvProjectDirectory, `.wp-env.${name}.json`);
}

function writeEnvironmentConfig(name, port) {
	const configPath = environmentConfig(name);
	return writeFile(
		configPath,
		JSON.stringify(
			{
				phpVersion: '8.1',
				core: 'WordPress/WordPress#7.1.2',
				plugins: [
					'https://downloads.wordpress.org/plugin/woocommerce.11.1.2.zip',
				],
				port,
				testsEnvironment: false,
				config: { WP_DEBUG: true, SCRIPT_DEBUG: false },
				mappings: {
					'wp-content/mu-plugins': muPluginDirectory,
					'wp-content/plugins/package-input': artifactDirectory,
				},
			},
			null,
			2
		)
	).then(() => configPath);
}

function wpEnv(configPath, port, ...args) {
	return capture(wpEnvCli, [`--config=${configPath}`, ...args], {
		cwd: wpEnvProjectDirectory,
		env: { ...process.env, WP_ENV_PORT: String(port) },
	});
}

function wp(configPath, port, ...args) {
	return wpEnv(configPath, port, 'run', 'cli', 'wp', ...args);
}

function assertExternalApiRequests(configPath, port, allowedRequests, stage) {
	const requests = parseJsonOutput(
		wp(
			configPath,
			port,
			'eval',
			'echo wp_json_encode(get_option("moda_w006_package_test_api_requests", array()));'
		)
	);
	wp(
		configPath,
		port,
		'eval',
		'delete_option("moda_w006_package_test_api_requests");'
	);
	assert.ok(
		requests.every((request) =>
			allowedRequests.some(
				(allowed) =>
					allowed.method === request.method &&
					allowed.path === request.path
			)
		),
		`${stage} initiated unexpected Moda API requests: ${JSON.stringify(requests)}`
	);
}

function assertNoExternalApiRequests(configPath, port, stage) {
	assertExternalApiRequests(configPath, port, [], stage);
}

async function installZip(configPath, port, archivePath, ...options) {
	const archivePathInContainer = `/var/www/html/wp-content/plugins/package-input/${basename(archivePath)}`;
	wp(
		configPath,
		port,
		'eval',
		`update_option("moda_w006_package_test_archive", "${archivePathInContainer}", false);`
	);
	const archiveReadable = wp(
		configPath,
		port,
		'eval',
		`echo is_readable("${archivePathInContainer}") ? "yes" : "no";`
	).trim();
	assert.equal(
		archiveReadable,
		'yes',
		'staged ZIP must be mounted in WP-CLI'
	);
	wp(
		configPath,
		port,
		'plugin',
		'install',
		'https://downloads.wordpress.org/plugin/moda-interact-w006-test.zip',
		...options
	);
}

function assertPluginInstalledAndActive(configPath, port) {
	const installed = parseJsonOutput(
		wp(configPath, port, 'plugin', 'list', '--format=json')
	);
	assert.ok(
		installed.some(
			(plugin) =>
				plugin.name === 'moda-interact' && plugin.status === 'active'
		)
	);
	const pluginFile = wp(
		configPath,
		port,
		'eval',
		'echo MODA_INTERACT_MAIN_PLUGIN_FILE;'
	).trim();
	assert.match(
		pluginFile,
		/\/wp-content\/plugins\/moda-interact\/moda-interact\.php$/
	);
}

async function assertAdminAssets(
	configPath,
	port,
	stage,
	expectedApiRequests = []
) {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const remoteRequests = [];
		page.on('request', (request) => {
			if (new URL(request.url()).hostname === 'api.modainteract.com') {
				remoteRequests.push(request.url());
			}
		});
		await page.goto(
			`http://localhost:${port}/wp-login.php?moda_w006_test_login=${adminRenderToken}`
		);
		await page.goto(
			`http://localhost:${port}/wp-admin/admin.php?page=wc-admin&path=%2Fmoda-interact`
		);
		await page.waitForLoadState('networkidle');
		const html = await page.content();
		assert.match(
			html,
			/\/wp-content\/plugins\/moda-interact\/build\/index\.js(?:\?|["'])/,
			`${stage} page did not load the packaged local JavaScript`
		);
		assert.match(
			html,
			/\/wp-content\/plugins\/moda-interact\/build\/index\.css(?:\?|["'])/,
			`${stage} page did not load the packaged local stylesheet`
		);
		await page
			.locator('#woocommerce-layout__primary')
			.getByRole('heading', { name: 'Moda Interact' })
			.waitFor();
		assert.match(
			await page.locator('body').innerText(),
			/Connection|Overview/
		);
		assert.deepEqual(
			remoteRequests,
			[],
			`${stage} browser application directly requested the Moda API`
		);
	} finally {
		await browser.close();
	}
	assertExternalApiRequests(
		configPath,
		port,
		expectedApiRequests,
		`${stage} Admin page render`
	);
}

async function buildBaselineArchive() {
	const tarArchive = capture(
		'git',
		['archive', '--format=tar', baselineCommit],
		{ encoding: 'buffer' }
	);
	capture('tar', ['-xf', '-', '-C', baselineDirectory], {
		encoding: 'utf8',
		input: tarArchive,
	});
	await symlink(
		resolve(repository, 'node_modules'),
		join(baselineDirectory, 'node_modules'),
		'dir'
	);
	run('npm', ['run', 'build'], baselineDirectory);
	run(
		'composer',
		['install', '--no-dev', '--no-interaction', '--classmap-authoritative'],
		baselineDirectory
	);
	run('wp-scripts', ['plugin-zip'], baselineDirectory);
	const baselineArchive = baselineArchiveInArtifacts;
	await copyFile(
		join(baselineDirectory, 'moda-interact.zip'),
		baselineArchive
	);
	return baselineArchive;
}

async function runFreshInstall(configPath, port) {
	let installed = true;
	try {
		wp(configPath, port, 'plugin', 'is-installed', 'moda-interact');
	} catch {
		installed = false;
	}
	assert.equal(
		installed,
		false,
		'fresh-install environment must start without Moda Interact'
	);
	assertNoExternalApiRequests(
		configPath,
		port,
		'fresh WordPress/WooCommerce startup'
	);
	await installZip(configPath, port, candidateArchive, '--activate');
	assertPluginInstalledAndActive(configPath, port);
	assert.equal(
		parseJsonOutput(
			wp(
				configPath,
				port,
				'eval',
				'echo wp_json_encode(get_option("moda_interact_woocommerce_connection", null));'
			)
		),
		null,
		'fresh installation must remain disconnected'
	);
	assertNoExternalApiRequests(
		configPath,
		port,
		'fresh package install and activation'
	);
	await assertAdminAssets(configPath, port, 'fresh candidate');
	assertReleaseLocales({
		wpEval: (php) => wp(configPath, port, 'eval', php),
		parseJsonOutput,
	});
	assertNoExternalApiRequests(
		configPath,
		port,
		'fresh installed locale matrix'
	);
	await assertReleaseBrowserLocales({
		chromium,
		wp: (...args) => wp(configPath, port, ...args),
		parseJsonOutput,
		siteUrl: `http://localhost:${port}`,
		loginToken: adminRenderToken,
	});
	assertNoExternalApiRequests(
		configPath,
		port,
		'fresh installed locale browser matrix'
	);
	process.stdout.write(
		'WOO-014: all installed UI locales rendered in fresh package.\n'
	);
}

async function runUpgrade(configPath, port) {
	await installZip(configPath, port, baselineArchive, '--activate');
	assertPluginInstalledAndActive(configPath, port);
	assertNoExternalApiRequests(
		configPath,
		port,
		'WOO-005 baseline install and activation'
	);
	await assertAdminAssets(configPath, port, 'WOO-005 baseline');

	const fixtureJson = JSON.stringify(fixture);
	const seeded = parseJsonOutput(
		wp(
			configPath,
			port,
			'eval',
			`$fixture = json_decode('${fixtureJson.replaceAll("'", "\\'")}', true); update_option("moda_interact_woocommerce_connection", $fixture, false); echo wp_json_encode(get_option("moda_interact_woocommerce_connection"));`
		)
	);
	assert.deepEqual(
		seeded,
		fixture,
		'synthetic fixture must match the accepted WOO-003 option schema'
	);
	const credentialFingerprint = createHash('sha256')
		.update(fixture.credential)
		.digest('hex');

	await installZip(
		configPath,
		port,
		candidateArchive,
		'--force',
		'--activate'
	);
	assertPluginInstalledAndActive(configPath, port);
	const afterUpgrade = parseJsonOutput(
		wp(
			configPath,
			port,
			'eval',
			'echo wp_json_encode(get_option("moda_interact_woocommerce_connection"));'
		)
	);
	assert.deepEqual(
		afterUpgrade,
		fixture,
		'in-place package upgrade changed WOO-003 connection state'
	);
	assertNoExternalApiRequests(configPath, port, 'in-place candidate update');
	await assertAdminAssets(
		configPath,
		port,
		'WOO-006 candidate after upgrade',
		[
			{ method: 'GET', path: '/v1/woocommerce/installation' },
			{ method: 'GET', path: '/v1/merchant/bootstrap' },
		]
	);
	assertReleaseLocales({
		wpEval: (php) => wp(configPath, port, 'eval', php),
		parseJsonOutput,
	});
	assertNoExternalApiRequests(
		configPath,
		port,
		'upgraded installed locale matrix'
	);

	wp(configPath, port, 'plugin', 'deactivate', 'moda-interact');
	assert.deepEqual(
		parseJsonOutput(
			wp(
				configPath,
				port,
				'eval',
				'echo wp_json_encode(get_option("moda_interact_woocommerce_connection"));'
			)
		),
		fixture,
		'deactivation deleted or changed WOO-003 connection state'
	);
	wp(configPath, port, 'plugin', 'activate', 'moda-interact');
	assert.deepEqual(
		parseJsonOutput(
			wp(
				configPath,
				port,
				'eval',
				'echo wp_json_encode(get_option("moda_interact_woocommerce_connection"));'
			)
		),
		fixture,
		'reactivation deleted or changed WOO-003 connection state'
	);
	assertNoExternalApiRequests(
		configPath,
		port,
		'upgrade/deactivate/reactivate lifecycle'
	);
	process.stdout.write(
		`Upgrade fixture preserved exactly; synthetic credential SHA-256 ${credentialFingerprint}.\n`
	);
}

const candidateDigest = createHash('sha256')
	.update(await readFile(candidateArchive))
	.digest('hex');
const candidateVersion = JSON.parse(
	await readFile(resolve(repository, 'package.json'), 'utf8')
).version;
const baselineArchive = await buildBaselineArchive();
await copyFile(candidateArchive, stagedCandidateArchive);
const configurations = [];

try {
	for (const [name, test] of [
		['package-fresh', runFreshInstall],
		['package-upgrade', runUpgrade],
	]) {
		const port = await availableWpEnvHostPort();
		const configPath = await writeEnvironmentConfig(name, port);
		configurations.push(configPath);
		process.stdout.write(`${name}: starting on host port ${port}.\n`);
		try {
			run(
				wpEnvCli,
				[`--config=${configPath}`, 'start'],
				wpEnvProjectDirectory,
				{
					...process.env,
					WP_ENV_PORT: String(port),
				}
			);
			wp(configPath, port, 'plugin', 'activate', 'woocommerce');
			wp(configPath, port, 'plugin', 'is-active', 'woocommerce');
			let modaInstalled = true;
			try {
				wp(configPath, port, 'plugin', 'is-installed', 'moda-interact');
			} catch {
				modaInstalled = false;
			}
			assert.equal(
				modaInstalled,
				false,
				'Moda must be absent before the test'
			);
			await test(configPath, port);
		} finally {
			try {
				run(
					wpEnvCli,
					[`--config=${configPath}`, 'stop'],
					wpEnvProjectDirectory,
					{
						...process.env,
						WP_ENV_PORT: String(port),
					}
				);
			} catch {
				process.stderr.write(
					`wp-env cleanup failed for ${name} (host port ${port}); inspect the containers created for this test run.\n`
				);
			}
		}
	}
	process.stdout.write(
		`Package lifecycle passed at WordPress 7.1.2 / WooCommerce 11.1.2 / PHP 8.1. Candidate ${candidateVersion}, SHA-256 ${candidateDigest}; WOO-005 baseline ${baselineCommit}.\n`
	);
} finally {
	await rm(stagingDirectory, { recursive: true, force: true });
	await rm(temporaryDirectory, { recursive: true, force: true });
}
