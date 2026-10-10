import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const repository = resolve(import.meta.dirname, '..');

function wpEnv(args) {
	return execFileSync(
		'npm',
		['exec', '--', 'wp-env', 'run', 'cli', 'wp', ...args],
		{
			cwd: repository,
			encoding: 'utf8',
			maxBuffer: 8 * 1024 * 1024,
		}
	);
}

const pluginDirectory = wpEnv([
	'eval',
	'echo dirname(MODA_INTERACT_MAIN_PLUGIN_FILE);',
]).trim();
if (!pluginDirectory.startsWith('/')) {
	throw new Error(
		'wp-env did not return an absolute mounted plugin directory'
	);
}

wpEnv([
	'i18n',
	'make-pot',
	pluginDirectory,
	`${pluginDirectory}/languages/moda-interact.pot`,
	'--domain=moda-interact',
	'--slug=moda-interact',
	'--package-name=Moda Interact',
	'--headers={"Report-Msgid-Bugs-To":""}',
	'--include=moda-interact.php,includes,src',
	'--exclude=build,node_modules,vendor,tests',
]);
// Do not allow a build's generated JS or the wall clock to perturb source extraction.
const potPath = resolve(repository, 'languages/moda-interact.pot');
const source = readFileSync(potPath, 'utf8');
if (/^#: .*build\//m.test(source)) {
	throw new Error('POT must not contain generated build references');
}
writeFileSync(
	potPath,
	source.replace(/^"POT-Creation-Date:.*\\n"$/m, '"POT-Creation-Date: \\n"')
);
process.stdout.write(
	'Generated languages/moda-interact.pot from the mounted Moda Interact plugin source.\n'
);
