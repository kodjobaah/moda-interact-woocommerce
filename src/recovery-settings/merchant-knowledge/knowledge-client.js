import apiFetch from '@wordpress/api-fetch';
import { merchantRestError } from '../merchant-rest-errors';
import { parseKnowledgePage, presentKnowledge } from './knowledge-response';
import { createKnowledgeUploader } from './knowledge-upload-transport';

export const KNOWLEDGE_PATH = '/moda-interact/v1/merchant/merchant-knowledge';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const fail = (code) => Object.assign(new Error(code), { code });

const exact = (value, fields) =>
	value !== null && typeof value === 'object' && !Array.isArray(value) &&
	Object.keys(value).length === fields.length &&
	fields.every((field) => Object.hasOwn(value, field));

function commandResult(value) {
	if (
		!value || typeof value !== 'object' || Array.isArray(value) ||
		!Object.hasOwn(value, 'knowledge') ||
		Object.keys(value).some((key) => !['knowledge', 'created', 'sourceId'].includes(key)) ||
		(Object.hasOwn(value, 'created') && typeof value.created !== 'boolean') ||
		(Object.hasOwn(value, 'sourceId') && !ID.test(value.sourceId))
	) throw fail('KNOWLEDGE_INVALID');
	const page = parseKnowledgePage(value.knowledge);
	// Present only validated server data, with UI affordances derived from it.
	return { ...value, knowledge: presentKnowledge(page) };
}
function editResult(value) {
	if (!exact(value, ['schemaVersion', 'sourceId', 'updated']) ||
		value.schemaVersion !== 1 || !ID.test(value.sourceId) || value.updated !== true) {
		throw fail('KNOWLEDGE_INVALID');
	}
	return value;
}
function uploadResult(value) {
	if (!exact(value, ['schemaVersion', 'sourceId', 'revisionId', 'generation', 'status']) ||
		value.schemaVersion !== 1 || !ID.test(value.sourceId) ||
		!ID.test(value.revisionId) || !Number.isSafeInteger(value.generation) ||
		value.generation < 1 || value.status !== 'ACCEPTED') {
		throw fail('KNOWLEDGE_INVALID');
	}
	return value;
}

// Browser defence-in-depth only: hosted API still enforces SSRF-safe URLs.
export function validKnowledgeUrl(value) {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		const clean = value.trim();
		return (
			url.protocol === 'https:' && !url.port && !!hostname &&
			hostname.includes('.') && !hostname.includes('[') &&
			!hostname.includes(']') && !url.username && !url.password &&
			!url.hash && !['localhost', '0.0.0.0', '::1', '[::1]'].includes(hostname) &&
			!hostname.endsWith('.local') && !hostname.endsWith('.localhost') &&
			!hostname.endsWith('.internal') && !hostname.endsWith('.test') &&
			!hostname.endsWith('.invalid') && !/^\d+(?:\.\d+)*$/.test(hostname) &&
			!/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname) &&
			clean.length <= 2048
		);
	} catch {
		return false;
	}
}

export function validKnowledgeFile(file, maxBytes, formatKey) {
	return (
		!!file &&
		(formatKey === 'CSV' || formatKey === 'XLSX'
			? (file.name ?? '').toLowerCase().endsWith(`.${formatKey.toLowerCase()}`)
			: /\.(csv|xlsx)$/i.test(file.name ?? '')) &&
		Number.isSafeInteger(file.size) && file.size > 0 &&
		Number.isSafeInteger(maxBytes) && maxBytes > 0 &&
		file.size <= maxBytes
	);
}

export function createMerchantKnowledgeClient(request = apiFetch, options = {}) {
	const uploader = createKnowledgeUploader({ request, ...options });
	async function exchange(path, method, data, context = {}) {
		try {
			const response = await request({
				path,
				method,
				...(data === undefined ? {} : { data }),
				signal: context.signal,
			});
			if (context.signal?.aborted) throw fail('ABORTED');
			return response;
		} catch (error) {
			if (error?.code === 'ABORTED') throw error;
			throw merchantRestError(error, 'KNOWLEDGE_UNAVAILABLE');
		}
	}
	function source(snapshot, sourceId) {
		if (!ID.test(sourceId)) throw fail('INVALID_REQUEST');
		const found = snapshot?.sources?.find((row) => row.id === sourceId);
		if (!found) throw fail('INVALID_REQUEST');
		return found;
	}
	async function read(context = {}) {
		let position = null;
		let baseline = null;
		const sources = [];
		const ids = new Set();
		for (let pageNumber = 0; pageNumber < 50; pageNumber++) {
			const path = KNOWLEDGE_PATH +
				(position === null ? '' : `?afterPosition=${position}`);
			const page = parseKnowledgePage(
				await exchange(path, 'GET', undefined, context)
			);
			const { sources: entries, nextPosition, ...metadata } = page;
			if (baseline && JSON.stringify(metadata) !== JSON.stringify(baseline)) {
				throw fail('CONFLICT');
			}
			baseline = metadata;
			for (const entry of entries) {
				if (ids.has(entry.id) || sources.length >= 1000) {
					throw fail('KNOWLEDGE_INVALID');
				}
				ids.add(entry.id);
				sources.push(entry);
			}
			if (nextPosition === null) {
				return presentKnowledge({ ...baseline, sources, nextPosition: null });
			}
			if (position !== null && nextPosition <= position ||
				!entries.length || nextPosition < entries[entries.length - 1].position) {
				throw fail('KNOWLEDGE_INVALID');
			}
			position = nextPosition;
		}
		throw fail('KNOWLEDGE_INVALID');
	}
	return {
		read,
		async addUrl(payload, context = {}) {
			return commandResult(await exchange(`${KNOWLEDGE_PATH}/sources`, 'POST', {
				name: payload.name.trim(), purposeKey: payload.purpose,
				dataFormatKey: 'WEB_PAGE', url: payload.url,
				languageTag: payload.languageTag,
			}, context));
		},
		async editSource(payload, context = {}) {
			const entry = source(context.snapshot, payload.id);
			if (entry.dataFormatKey === 'WEB_PAGE') {
				return commandResult(await exchange(
					`${KNOWLEDGE_PATH}/sources/${entry.id}`, 'PATCH', {
						expectedGeneration: entry.currentGeneration,
						name: payload.name.trim(), url: payload.url,
						languageTag: payload.languageTag,
					}, context
				));
			}
			return editResult(await exchange(
				`${KNOWLEDGE_PATH}/uploads/${entry.id}`, 'PATCH', {
					name: payload.name.trim(), languageTag: payload.languageTag,
				}, context
			));
		},
		async deleteSource(payload, context = {}) {
			const entry = source(context.snapshot, payload.id);
			return commandResult(await exchange(
					`${KNOWLEDGE_PATH}/sources/${entry.id}`, 'DELETE',
					{ expectedGeneration: entry.currentGeneration }, context
			));
		},
		async refreshSource(payload, context = {}) {
			const entry = source(context.snapshot, payload.id);
			return commandResult(await exchange(
					`${KNOWLEDGE_PATH}/sources/${entry.id}/refresh`, 'POST',
					{ expectedGeneration: entry.currentGeneration }, context
			));
		},
		async moveSource(payload, context = {}) {
			return commandResult(await exchange(
					`${KNOWLEDGE_PATH}/order`, 'PUT',
					{ sourceIds: payload.sourceIds }, context
			));
		},
		async reprocessSource(payload, context = {}) {
			const entry = source(context.snapshot, payload.id);
			return uploadResult(await exchange(
					`${KNOWLEDGE_PATH}/uploads/${entry.id}/reprocess`,
					'POST', undefined, context
			));
		},
		async upload(payload, context = {}) {
			try {
				return uploadResult(await uploader({
					...payload,
					maxUploadBytes: context.snapshot?.maxUploadBytes,
					catalogue: context.snapshot?.catalogue ?? [],
				}, context));
			} catch (error) {
				if ((typeof error?.code === 'string' && error.code.startsWith('UPLOAD_')) ||
				error?.code === 'ABORTED' ||
					['KNOWLEDGE_INVALID', 'INVALID_REQUEST'].includes(error?.code)) {
					throw error;
				}
				throw merchantRestError(error, 'KNOWLEDGE_UNAVAILABLE');
			}
		},
		async replaceSource(payload, context = {}) {
			const entry = source(context.snapshot, payload.id);
			if (entry.dataFormatKey !== payload.dataFormatKey ||
				entry.purposeKey !== payload.purpose) throw fail('INVALID_REQUEST');
			return this.upload(payload, context);
		},
	};
}
