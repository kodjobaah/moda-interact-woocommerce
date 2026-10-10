import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { originalKey, poFromFile } from './gettext.mjs';

const project = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const callPattern =
	/\b(?:__|_e|_x|_n|_nx|esc_html__|esc_attr__|esc_html_e|esc_attr_e|esc_html_x|esc_attr_x)\s*\(/g;
const literalPattern = /^\s*(['"])(.*?)\1\s*,\s*(['"])moda-interact\3\s*\)/s;

function walk(directory, extension) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const file = join(directory, entry.name);
		if (entry.isDirectory()) {
			return walk(file, extension);
		}
		return entry.isFile() && extname(file) === extension ? [file] : [];
	});
}

/**
 * Enforce the currently supported literal gettext convention. Unknown call
 * signatures must fail closed and be reviewed rather than skip a new label.
 * WordPress make-pot remains authoritative when an additional signature is added.
 *
 * @param {string} source PHP/React source text to inspect.
 * @param {string} name   File name used in diagnostic messages.
 */
export function sourceMessages(source, name) {
	const keys = [];
	for (const call of source.matchAll(callPattern)) {
		const content = source.slice(call.index + call[0].length);
		const match = literalPattern.exec(content);
		assert.ok(
			match,
			`${name}: unsupported gettext call near ${call.index}`
		);
		keys.push(match[2]);
	}
	return keys;
}

/**
 * Fail the release if a source literal was added without a regenerated POT,
 * or if the POT no longer corresponds to any actual translation source.
 *
 * @param {Object} root0      Verifier options.
 * @param {string} root0.root Plugin source-tree root.
 */
export function verifyTranslationSources({ root = project } = {}) {
	const phpFiles = walk(join(root, 'includes'), '.php');
	const jsFiles = walk(join(root, 'src'), '.js');
	const pluginPath = join(root, 'moda-interact.php');
	const keys = new Set();
	for (const filename of [pluginPath, ...phpFiles, ...jsFiles]) {
		const content = readFileSync(filename, 'utf8');
		for (const key of sourceMessages(content, filename)) {
			keys.add(key);
		}
	}
	const pluginSource = readFileSync(pluginPath, 'utf8');
	const description = /^\s*\*\s*Description:\s*(.+?)\s*$/m.exec(pluginSource);
	assert.ok(description, 'WordPress plugin description could not be found');
	keys.add(description[1]);
	const template = new Set(
		poFromFile(join(root, 'languages/moda-interact.pot'))
			.filter((entry) => entry.id)
			.map(originalKey)
	);
	assert.deepEqual(
		keys,
		template,
		'POT differs from PHP/React gettext literals; regenerate and translate new keys'
	);
	return { sourceMessages: keys.size };
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const result = verifyTranslationSources();
	process.stdout.write(
		`i18n source: ${result.sourceMessages} messages match PHP/React.\n`
	);
}
