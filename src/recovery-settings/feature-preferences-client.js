import apiFetch from '@wordpress/api-fetch';
import { merchantRestError } from './merchant-rest-errors';

export const FEATURE_PREFERENCES_PATH =
	'/moda-interact/v1/merchant/feature-preferences';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const REVISION = /^[a-f0-9]{64}$/;
const own = (value, fields) =>
	value !== null &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	Object.keys(value).length === fields.length &&
	fields.every((field) => Object.hasOwn(value, field));

/**
 * Strict, browser-side validation of API-014's revisioned response.
 * @param {unknown} value - Untrusted API response.
 */
export function parseFeaturePreferences(value) {
	if (
		!own(value, ['schemaVersion', 'revision', 'features']) ||
		value.schemaVersion !== 1 ||
		typeof value.revision !== 'string' ||
		!REVISION.test(value.revision) ||
		!Array.isArray(value.features) ||
		value.features.length > 1000
	) {
		throw new Error('FEATURES_INVALID');
	}
	const ids = new Set();
	for (const feature of value.features) {
		if (
			!own(feature, [
				'id',
				'key',
				'name',
				'description',
				'enabled',
				'effective',
				'editable',
				'required',
				'planEligible',
			]) ||
			typeof feature.id !== 'string' ||
			!ID.test(feature.id) ||
			ids.has(feature.id) ||
			typeof feature.key !== 'string' ||
			!ID.test(feature.key) ||
			typeof feature.name !== 'string' ||
			!feature.name.trim() ||
			feature.name.length > 255 ||
			(feature.description !== null &&
				(typeof feature.description !== 'string' ||
					feature.description.length > 10000)) ||
			![
				'enabled',
				'effective',
				'editable',
				'required',
				'planEligible',
			].every((key) => typeof feature[key] === 'boolean') ||
			(feature.editable && (!feature.planEligible || feature.required)) ||
			(feature.effective && !feature.planEligible)
		) {
			throw new Error('FEATURES_INVALID');
		}
		ids.add(feature.id);
	}
	return value;
}

// The installation credential and WordPress nonce are applied by apiFetch's
// existing same-origin middleware, never sent to the browser-direct R2 PUT.
export function createFeaturePreferencesClient(request = apiFetch) {
	return {
		async read(options = {}) {
			try {
				return parseFeaturePreferences(
					await request({
						path: FEATURE_PREFERENCES_PATH,
						method: 'GET',
						signal: options.signal,
					})
				);
			} catch (error) {
				if (error?.message === 'FEATURES_INVALID') {
					throw error;
				}
				throw merchantRestError(error, 'FEATURES_UNAVAILABLE');
			}
		},
		async save({ expectedRevision, changes }, options = {}) {
			if (
				typeof expectedRevision !== 'string' ||
				!REVISION.test(expectedRevision) ||
				!Array.isArray(changes) ||
				changes.length !== 1 ||
				!ID.test(changes[0]?.featureId) ||
				typeof changes[0]?.enabled !== 'boolean'
			) {
				throw new Error('INVALID_REQUEST');
			}
			try {
				return parseFeaturePreferences(
					await request({
						path: FEATURE_PREFERENCES_PATH,
						method: 'PUT',
						data: { expectedRevision, changes },
						signal: options.signal,
					})
				);
			} catch (error) {
				if (error?.message === 'FEATURES_INVALID') {
					throw error;
				}
				throw merchantRestError(error, 'FEATURES_UNAVAILABLE');
			}
		},
	};
}
