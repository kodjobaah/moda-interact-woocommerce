import { readFileSync } from 'node:fs';

/**
 * Parse the PO subset emitted by WP-CLI, including multiline, context and plurals.
 * @param {string} source
 */
export function parsePo(source) {
	const entries = [];
	let entry = { references: [], translations: [] };
	let current = null;

	function flush() {
		if (typeof entry.id === 'string') {
			entries.push(entry);
		}
		entry = { references: [], translations: [] };
		current = null;
	}

	for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
		if (!line.trim()) {
			flush();
			continue;
		}
		if (line.startsWith('#~') || line.startsWith('#,')) {
			if (line.includes('fuzzy')) {
				entry.fuzzy = true;
			}
			continue;
		}
		if (line.startsWith('#:')) {
			entry.references.push(...line.slice(2).trim().split(/\s+/));
			continue;
		}
		if (line.startsWith('#')) {
			continue;
		}
		const item = line.match(
			/^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(".*")$/
		);
		if (item) {
			const value = JSON.parse(item[3]);
			if (item[1] === 'msgctxt') {
				entry.context = value;
				current = { key: 'context' };
			} else if (item[1] === 'msgid') {
				entry.id = value;
				current = { key: 'id' };
			} else if (item[1] === 'msgid_plural') {
				entry.plural = value;
				current = { key: 'plural' };
			} else {
				const index = item[2] ? Number(item[2]) : 0;
				entry.translations[index] = value;
				current = { key: 'translations', index };
			}
			continue;
		}
		if (line.startsWith('"') && current) {
			const value = JSON.parse(line);
			if (current.key === 'translations') {
				entry.translations[current.index] += value;
			} else {
				entry[current.key] += value;
			}
			continue;
		}
		throw new Error(`Unsupported PO syntax: ${line.slice(0, 80)}`);
	}
	flush();
	return entries.filter((item) => !item.fuzzy);
}

export function poFromFile(path) {
	return parsePo(readFileSync(path, 'utf8'));
}

export function originalKey(entry) {
	return `${entry.context ? `${entry.context}\u0004` : ''}${entry.id}${entry.plural === undefined ? '' : `\u0000${entry.plural}`}`;
}

export function translatedValue(entry) {
	return entry.translations.join('\u0000');
}

export function isJavaScriptMessage(entry) {
	return entry.references.some((ref) =>
		/^src\/.*\.(?:js|jsx|mjs|ts|tsx)(?::\d+)?$/.test(ref)
	);
}

/**
 * Write a GNU gettext MO file, little endian, with deterministic key order.
 * @param {Array<Object>} entries
 */
export function makeMo(entries) {
	const pairs = entries
		.filter((item) => typeof item.id === 'string')
		.map((entry) => [
			Buffer.from(originalKey(entry)),
			Buffer.from(translatedValue(entry)),
		])
		.sort((left, right) => Buffer.compare(left[0], right[0]));
	const count = pairs.length;
	const headerSize = 28 + count * 16;
	const header = Buffer.alloc(headerSize);
	header.writeUInt32LE(0x950412de, 0);
	header.writeUInt32LE(0, 4);
	header.writeUInt32LE(count, 8);
	header.writeUInt32LE(28, 12);
	header.writeUInt32LE(28 + count * 8, 16);
	const buffers = [header];
	let offset = headerSize;
	for (let index = 0; index < count; index++) {
		const value = pairs[index][0];
		header.writeUInt32LE(value.length, 28 + index * 8);
		header.writeUInt32LE(offset, 28 + index * 8 + 4);
		buffers.push(value, Buffer.from([0]));
		offset += value.length + 1;
	}
	for (let index = 0; index < count; index++) {
		const value = pairs[index][1];
		header.writeUInt32LE(value.length, 28 + count * 8 + index * 8);
		header.writeUInt32LE(offset, 28 + count * 8 + index * 8 + 4);
		buffers.push(value, Buffer.from([0]));
		offset += value.length + 1;
	}
	return Buffer.concat(buffers);
}

/**
 * Format matches WordPress's Jed locale_data payload.
 * @param {Array<Object>} entries
 * @param {string}        locale
 */
export function makeScriptJson(entries, locale) {
	const header = entries.find((item) => item.id === '');
	const pluralForm = header?.translations[0]?.match(
		/Plural-Forms:\s*([^\n]+)/i
	)?.[1];
	if (!pluralForm) {
		throw new Error(`${locale} translation header lacks Plural-Forms`);
	}
	const messages = {
		'': {
			domain: 'moda-interact',
			lang: locale,
			'plural-forms': pluralForm,
		},
	};
	for (const entry of entries) {
		if (!entry.id || !isJavaScriptMessage(entry)) {
			continue;
		}
		const key = `${entry.context ? `${entry.context}\u0004` : ''}${entry.id}`;
		messages[key] = entry.translations;
	}
	return `${JSON.stringify({ 'translation-revision-date': '', generator: 'Moda Interact i18n', domain: 'messages', locale_data: { messages } }, null, 2)}\n`;
}
