import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const archivePath = resolve(repository, 'moda-interact.zip');
const productionOrigin = 'https://api.modainteract.com';

function capture(program, args) {
	return execFileSync(program, args, {
		cwd: repository,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
}

function run(program, args) {
	const result = spawnSync(program, args, {
		cwd: repository,
		stdio: 'inherit',
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`${program} ${args.join(' ')} exited with ${result.status}`
		);
	}
}

function trackedSnapshot() {
	return createHash('sha256')
		.update(capture('git', ['diff', '--binary', 'HEAD', '--']))
		.digest('hex');
}

function readArchiveFile(path) {
	return capture('unzip', ['-p', archivePath, `moda-interact/${path}`]);
}

function assertNoPattern(contents, pattern, description) {
	assert.doesNotMatch(contents, pattern, description);
}

function verifyPackage() {
	const packageJson = JSON.parse(
		readFileSync(resolve(repository, 'package.json'), 'utf8')
	);
	const packageLock = JSON.parse(
		readFileSync(resolve(repository, 'package-lock.json'), 'utf8')
	);
	const plugin = readFileSync(
		resolve(repository, 'moda-interact.php'),
		'utf8'
	);
	const changelog = readFileSync(resolve(repository, 'CHANGELOG.md'), 'utf8');
	const version = packageJson.version;
	assert.equal(
		packageLock.packages[''].version,
		version,
		'package-lock root version must match package.json'
	);
	assert.match(
		plugin,
		new RegExp(
			`^\\s*\\* Version: ${version.replaceAll('.', '\\.')}\\s*$`,
			'm'
		)
	);
	assert.equal(
		changelog.match(/^##\s+(\S+)/m)?.[1],
		version,
		'current changelog heading must match package version'
	);

	const entries = capture('unzip', ['-Z1', archivePath])
		.trim()
		.split('\n')
		.filter(Boolean);
	assert.ok(entries.length > 0, 'production archive must not be empty');
	assert.ok(
		entries.every((entry) => entry.startsWith('moda-interact/')),
		'archive must contain exactly the moda-interact/ root'
	);
	assert.ok(entries.includes('moda-interact/moda-interact.php'));
	for (const required of [
		'moda-interact/readme.txt',
		'moda-interact/README.md',
		'moda-interact/CHANGELOG.md',
		'moda-interact/includes/Api/ModaApiConfiguration.php',
		'moda-interact/build/index.js',
		'moda-interact/build/index.css',
		'moda-interact/build/index.asset.php',
		'moda-interact/languages/moda-interact.pot',
		'moda-interact/vendor/autoload.php',
		'moda-interact/vendor/composer/autoload_psr4.php',
		'moda-interact/vendor/composer/installed.json',
	]) {
		assert.ok(
			entries.includes(required),
			`required package file missing: ${required}`
		);
	}

	const prohibitedPath =
		/(?:^|\/)(?:\.git|\.github|node_modules|src|tests|coverage|logs?|cache|__pycache__|vendor\/bin)(?:\/|$)|(?:^|\/)\.env[^/]*(?:$|\/)|\.DS_Store$|\.map$|\.wp-env[^/]*$|phpunit\.xml/i;
	assert.ok(
		!entries.some((entry) => prohibitedPath.test(entry)),
		'archive contains a prohibited development, cache, source-map or test path'
	);

	const productionPackages = JSON.parse(
		readArchiveFile('vendor/composer/installed.json')
	);
	const installedPackages = Array.isArray(productionPackages)
		? productionPackages
		: (productionPackages.packages ?? []);
	assert.ok(
		installedPackages.every(
			(entry) =>
				!/^(?:phpunit\/|sebastian\/|phar-io\/|myclabs\/deep-copy$)/.test(
					entry.name
				)
		),
		'Composer require-dev packages must not enter the archive'
	);
	assert.ok(
		!entries.some((entry) => entry.startsWith('moda-interact/vendor/bin/')),
		'Composer vendor/bin must not enter the archive'
	);

	// Locale batches are optional until WOO-014, but every present PO must
	// compile into both WordPress PHP and handle-specific JS assets.
	for (const source of readdirSync(resolve(repository, 'languages'))) {
		const match = source.match(/^moda-interact-([A-Za-z_]+)\.po$/);
		if (!match) {
			continue;
		}
		for (const extension of [
			`moda-interact-${match[1]}.mo`,
			`moda-interact-${match[1]}-moda-interact.json`,
		]) {
			assert.ok(
				entries.includes(`moda-interact/languages/${extension}`),
				`compiled translation missing from ZIP: ${extension}`
			);
		}
	}
	const pot = readArchiveFile('languages/moda-interact.pot');
	assert.match(pot, /X-Domain: moda-interact/);
	assert.match(pot, /Moda Interact/);
	assertNoPattern(
		pot,
		/Woo Plugin Setup|psealock|woo-plugin-setup/i,
		'translation template retains scaffold identity'
	);
	assert.match(
		pot,
		/^"Report-Msgid-Bugs-To:[ \t]*\\n"$/m,
		'translation template must not invent a support destination'
	);
	assertNoPattern(
		pot,
		/ARCH-\d+-[A-Z0-9-]+/,
		'translation template contains an internal architecture task identifier'
	);

	const readme = readArchiveFile('readme.txt');
	assert.match(readme, /== External services ==/);
	assert.match(readme, /https:\/\/api\.modainteract\.com/);
	assert.match(readme, /site URL/i);
	assert.match(readme, /installation identity/i);
	assertNoPattern(
		readme,
		/(?:privacy|terms)(?:-of-service)?\s*(?:URL|link)|(?:billing|recovery|coupon|messaging)\s+(?:is available|is supported|is included|features are available)/i,
		'readme invents a legal-policy URL or advertises an unimplemented capability'
	);

	const runtimePaths = entries.filter(
		(entry) =>
			entry.startsWith('moda-interact/includes/') ||
			entry === 'moda-interact/moda-interact.php' ||
			/^moda-interact\/build\/.*\.(?:js|css)$/.test(entry)
	);
	const runtime = runtimePaths.map((path) => [
		path,
		capture('unzip', ['-p', archivePath, path]),
	]);
	const runtimePhp = runtime.filter(([path]) => path.endsWith('.php'));
	const runtimeJavaScript = runtime.filter(([path]) => path.endsWith('.js'));
	const runtimeText = runtime.map(([, contents]) => contents).join('\n');
	assert.equal(
		runtimePhp
			.filter(([, contents]) => contents.includes(productionOrigin))
			.map(([path]) => path)
			.join(','),
		'moda-interact/includes/Api/ModaApiConfiguration.php',
		'production API origin must be owned by the PHP API configuration only'
	);
	assert.match(
		readArchiveFile('includes/Api/ModaApiConfiguration.php'),
		/https:\/\/api\.modainteract\.com/
	);
	assertNoPattern(
		runtimeText,
		/api-test\.modainteract\.com|https?:\/\/(?:localhost|127\.0\.0\.1|host\.docker\.internal)(?::\d+)?/i,
		'runtime contains a test or local API origin'
	);
	assertNoPattern(
		runtime
			.filter(([path]) => path.endsWith('.js'))
			.map(([, contents]) => contents)
			.join('\n'),
		/api\.modainteract\.com|api-test\.modainteract\.com|bootstrapSecret|installationCredential|Bearer\s+[A-Za-z0-9_-]{20,}/i,
		'browser runtime contains a Moda endpoint or credential material'
	);
	assertNoPattern(
		runtimeText,
		/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|GOCSPX-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|sk_(?:live|test)_[A-Za-z0-9]{12,}/,
		'runtime contains a recognized secret or private key'
	);
	assertNoPattern(
		runtimeText,
		/https?:\/\/[^\s"'`)]+\.(?:js|css|woff2?|ttf|eot)(?:[?#][^\s"'`)]*)?/i,
		'runtime references a remotely hosted executable asset'
	);
	assert.ok(runtimePhp.length > 0 && runtimeJavaScript.length > 0);

	capture('unzip', ['-tq', archivePath]);
	return { entries, version };
}

const trackedBefore = trackedSnapshot();
run('npm', ['run', 'build']);
run('npm', ['run', 'i18n:compile']);
run('composer', [
	'install',
	'--no-dev',
	'--no-interaction',
	'--classmap-authoritative',
]);
run('wp-scripts', ['plugin-zip']);
const { entries, version } = verifyPackage();
assert.equal(
	trackedSnapshot(),
	trackedBefore,
	'production packaging changed tracked repository files'
);
const digest = createHash('sha256')
	.update(readFileSync(archivePath))
	.digest('hex');
process.stdout.write(
	`Production package verified: moda-interact.zip (${version}, ${entries.length} entries, SHA-256 ${digest}).\n`
);
