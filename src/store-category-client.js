import apiFetch from '@wordpress/api-fetch';

export const STORE_CATEGORIES_PATH =
	'/moda-interact/v1/merchant/store-categories';
export const STORE_CATEGORY_PATH = '/moda-interact/v1/merchant/store-category';

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value, expected) {
	return (
		record(value) &&
		Object.keys(value).length === expected.length &&
		expected.every((key) => Object.hasOwn(value, key))
	);
}

function text(value, max, optional = false) {
	return (
		typeof value === 'string' &&
		(optional || value.length > 0) &&
		value.length <= max
	);
}

function ids(value, limit) {
	return (
		Array.isArray(value) &&
		value.length <= limit &&
		value.every((item) => text(item, 128)) &&
		new Set(value).size === value.length
	);
}

function identity(value) {
	return (
		value === null ||
		(keys(value, [
			'id',
			'slug',
			'localizedDisplayName',
			'localizedDescription',
		]) &&
			text(value.id, 128) &&
			text(value.slug, 128) &&
			text(value.localizedDisplayName, 255) &&
			text(value.localizedDescription, 4096, true))
	);
}

function template(value, pending = false) {
	return (
		keys(value, ['id', 'key', 'displayName', 'editVersion']) &&
		text(value.id, 128) &&
		text(value.key, 128) &&
		text(value.displayName, 255) &&
		((pending && value.editVersion === null) ||
			(Number.isInteger(value.editVersion) && value.editVersion >= 1))
	);
}

function choice(value) {
	return (
		keys(value, [
			'id',
			'slug',
			'localizedDisplayName',
			'localizedDescription',
			'mappings',
			'defaultTemplate',
		]) &&
		text(value.id, 128) &&
		text(value.slug, 128) &&
		text(value.localizedDisplayName, 255) &&
		text(value.localizedDescription, 4096, true) &&
		Array.isArray(value.mappings) &&
		value.mappings.length <= 50 &&
		value.mappings.every(
			(mapping) =>
				keys(mapping, ['id', 'conditionKey', 'localizedDisplayName']) &&
				text(mapping.id, 128) &&
				text(mapping.conditionKey, 128) &&
				text(mapping.localizedDisplayName, 255)
		) &&
		template(value.defaultTemplate)
	);
}

export function parseStoreCategories(data) {
	if (
		!keys(data, [
			'schemaVersion',
			'requestedLocale',
			'resolvedLocale',
			'categories',
			'storeProfile',
		]) ||
		data.schemaVersion !== 1 ||
		!(data.requestedLocale === null || text(data.requestedLocale, 64)) ||
		!text(data.resolvedLocale, 16) ||
		!Array.isArray(data.categories) ||
		data.categories.length > 100 ||
		!data.categories.every(choice)
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	const profile = data.storeProfile;
	if (
		!keys(profile, [
			'activeCategory',
			'pendingCategory',
			'activeMappingIds',
			'pendingMappingIds',
			'pendingSelectionGeneration',
			'pendingSelectedAt',
			'pendingState',
			'pendingTemplate',
		]) ||
		!identity(profile.activeCategory) ||
		!identity(profile.pendingCategory) ||
		!ids(profile.activeMappingIds, 256) ||
		!ids(profile.pendingMappingIds, 256) ||
		!Number.isSafeInteger(profile.pendingSelectionGeneration) ||
		profile.pendingSelectionGeneration < 0 ||
		!(
			profile.pendingSelectedAt === null ||
			text(profile.pendingSelectedAt, 64)
		) ||
		!['NONE', 'PENDING_PUBLICATION'].includes(profile.pendingState) ||
		!(
			profile.pendingTemplate === null ||
			template(profile.pendingTemplate, true)
		)
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return data;
}

export function parseCategorySelection(data) {
	if (
		!keys(data, [
			'schemaVersion',
			'activeCategoryId',
			'activePromptRevisionId',
			'activeMappingIds',
			'pendingSelectionGeneration',
		]) ||
		data.schemaVersion !== 1 ||
		!text(data.activeCategoryId, 128) ||
		!text(data.activePromptRevisionId, 128) ||
		!ids(data.activeMappingIds, 50) ||
		!Number.isSafeInteger(data.pendingSelectionGeneration) ||
		data.pendingSelectionGeneration < 1
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return data;
}

const ERROR_CODES = new Set([
	'STORE_CATEGORY_CONFLICT',
	'CATEGORY_UNAVAILABLE',
	'RECONNECT_REQUIRED',
	'SITE_URL_CHANGED',
	'LOCAL_STATE_INVALID',
	'REMOTE_UNAVAILABLE',
	'REMOTE_RESPONSE_INVALID',
]);

function mapError(error) {
	const code = error?.data?.status ?? error?.status ?? error?.message;
	return new Error(ERROR_CODES.has(code) ? code : 'REMOTE_UNAVAILABLE');
}

export function createStoreCategoryClient(request = apiFetch) {
	return {
		async read() {
			try {
				return parseStoreCategories(
					await request({
						path: STORE_CATEGORIES_PATH,
						method: 'GET',
					})
				);
			} catch (error) {
				throw mapError(error);
			}
		},
		async save(categoryId, mappingIds, generation) {
			try {
				const data = parseCategorySelection(
					await request({
						path: STORE_CATEGORY_PATH,
						method: 'POST',
						data: {
							schemaVersion: 1,
							categoryId,
							selectedMappingIds: [...mappingIds],
							expectedPendingSelectionGeneration: generation,
						},
					})
				);
				if (
					data.activeCategoryId !== categoryId ||
					data.pendingSelectionGeneration <= generation
				) {
					throw new Error('REMOTE_RESPONSE_INVALID');
				}
				return data;
			} catch (error) {
				throw mapError(error);
			}
		},
	};
}
