import {
	existsSync,
	readdirSync,
	writeFileSync,
	mkdirSync,
	rmSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LOCALES } from './locales.mjs';
import {
	isJavaScriptMessage,
	makeMo,
	makeScriptJson,
	originalKey,
	poFromFile,
} from './gettext.mjs';

const projectRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TEXT_DOMAIN = 'moda-interact';
const SCRIPT_HANDLE = 'moda-interact';

function translationPlaceholders(value) {
	return [
		...value.matchAll(
			/%(?:\d+\$)?[-+#0 ]*(?:\d+)?(?:\.\d+)?[bcdeEfFgGosuxX]/g
		),
	]
		.map((match) => match[0])
		.sort();
}

function verifyTranslation(entry, locale) {
	if (
		!entry.translations.length ||
		(entry.plural && entry.translations.length < 2) ||
		entry.translations.some((value) => !value)
	) {
		throw new Error(
			`${locale} missing translation: ${entry.id.slice(0, 100)}`
		);
	}
	const sourceVariants = [entry.id, entry.plural ?? entry.id];
	for (const [index, translated] of entry.translations.entries()) {
		const source =
			sourceVariants[Math.min(index, sourceVariants.length - 1)];
		if (
			JSON.stringify(translationPlaceholders(source)) !==
			JSON.stringify(translationPlaceholders(translated))
		) {
			throw new Error(
				`${locale} placeholder mismatch: ${entry.id.slice(0, 100)}`
			);
		}
	}
}

/**
 * Build strict translated assets for any present locale batch. Missing batches
 * are allowed until WOO-014; --strict requires all 19 translated catalogues.
 * @param {Object}  root0
 * @param {string}  root0.languagesDirectory
 * @param {string}  root0.outputDirectory
 * @param {boolean} root0.strict
 */
export function compileCatalogues({
	languagesDirectory = join(projectRoot, 'languages'),
	outputDirectory = languagesDirectory,
	strict = false,
} = {}) {
	const template = poFromFile(join(languagesDirectory, `${TEXT_DOMAIN}.pot`));
	const required = new Map(
		template
			.filter((entry) => entry.id)
			.map((entry) => [originalKey(entry), entry])
	);
	if (!required.size || ![...required.values()].some(isJavaScriptMessage)) {
		throw new Error('Source-only POT must contain JavaScript messages');
	}
	const output = new Map();
	const ready = [];
	const knownFiles = new Set(
		SUPPORTED_LOCALES.filter((item) => item.tag !== 'en').map(
			(item) => `${TEXT_DOMAIN}-${item.wordpress[0]}.po`
		)
	);
	for (const filename of readdirSync(languagesDirectory)) {
		if (
			filename.startsWith(`${TEXT_DOMAIN}-`) &&
			filename.endsWith('.po') &&
			!knownFiles.has(filename)
		) {
			throw new Error(
				`Unknown WordPress translation source: ${filename}`
			);
		}
	}
	for (const { tag, wordpress } of SUPPORTED_LOCALES) {
		if (tag === 'en') {
			continue; // English is the gettext source; no English pseudo-translations.
		}
		const source = join(
			languagesDirectory,
			`${TEXT_DOMAIN}-${wordpress[0]}.po`
		);
		if (!existsSync(source)) {
			if (strict) {
				throw new Error(`Missing ${tag} catalogue: ${source}`);
			}
			continue;
		}
		const catalogue = poFromFile(source);
		const entries = new Map(
			catalogue
				.filter((entry) => entry.id)
				.map((entry) => [originalKey(entry), entry])
		);
		for (const [key, entry] of required) {
			const translation = entries.get(key);
			if (!translation) {
				throw new Error(
					`${tag} missing source key: ${entry.id.slice(0, 100)}`
				);
			}
			// The source template carries the canonical PHP/JS reference set.
			translation.references = entry.references;
			verifyTranslation(translation, tag);
		}
		for (const key of entries.keys()) {
			if (!required.has(key)) {
				throw new Error(
					`${tag} contains obsolete translation key: ${key.slice(0, 100)}`
				);
			}
		}
		const header = catalogue.find((entry) => entry.id === '');
		if (!header?.translations[0]?.includes('Plural-Forms:')) {
			throw new Error(`${tag} has no Plural-Forms header`);
		}
		for (const locale of wordpress) {
			const complete = [header, ...required.keys()].map((item) =>
				typeof item === 'string' ? entries.get(item) : item
			);
			output.set(`${TEXT_DOMAIN}-${locale}.mo`, makeMo(complete));
			output.set(
				`${TEXT_DOMAIN}-${locale}-${SCRIPT_HANDLE}.json`,
				makeScriptJson(complete, locale)
			);
		}
		ready.push(tag);
	}
	// Do not leave a stale translation asset in place if its PO was removed.
	mkdirSync(outputDirectory, { recursive: true });
	for (const filename of readdirSync(outputDirectory)) {
		if (/^moda-interact-[\w-]+\.(mo|json)$/.test(filename)) {
			rmSync(join(outputDirectory, filename));
		}
	}
	for (const [name, bytes] of output) {
		writeFileSync(join(outputDirectory, name), bytes);
	}
	return {
		requiredMessages: required.size,
		translatedLanguages: ready,
		assets: [...output.keys()],
	};
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const strict = process.argv.includes('--strict');
	const result = compileCatalogues({ strict });
	process.stdout.write(
		`i18n: ${result.requiredMessages} source messages; ${result.translatedLanguages.length}/19 translation packs; ${result.assets.length} generated assets${strict ? ' (strict)' : ' (bootstrap)'}.\n`
	);
}
