import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

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
	'--exclude=node_modules,vendor,tests',
]);
process.stdout.write(
	'Generated languages/moda-interact.pot from the mounted Moda Interact plugin source.\n'
);
