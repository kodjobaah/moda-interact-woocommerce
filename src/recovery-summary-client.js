import apiFetch from '@wordpress/api-fetch';

export const RECOVERY_SUMMARY_PATH =
	'/moda-interact/v1/merchant/recovery-summary';

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Strictly validate the hosted API's effective recovery summary.
 *
 * @param {unknown} value Response body.
 * @return {Object} Safe summary response.
 */
export function parseRecoverySummary(value) {
	if (!record(value)) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	const required = [
		'schemaVersion',
		'recoveryDelayMinutes',
		'recoveryOfferMode',
		'followUpEnabled',
		'followUpDelayMinutes',
		'source',
	];
	if (
		Object.keys(value).length !== required.length ||
		required.some((key) => !Object.hasOwn(value, key)) ||
		value.schemaVersion !== 1 ||
		!Number.isInteger(value.recoveryDelayMinutes) ||
		value.recoveryDelayMinutes < 0 ||
		value.recoveryDelayMinutes > 10080 ||
		!['NONE', 'FIXED', 'AI_BEST_APPLICABLE'].includes(
			value.recoveryOfferMode
		) ||
		typeof value.followUpEnabled !== 'boolean' ||
		(value.followUpEnabled
			? !Number.isInteger(value.followUpDelayMinutes) ||
				value.followUpDelayMinutes < 1 ||
				value.followUpDelayMinutes > 10080
			: value.followUpDelayMinutes !== null) ||
		!['MERCHANT', 'ADMIN_OVERRIDE'].includes(value.source)
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return { ...value };
}

export function createRecoverySummaryClient(request = apiFetch) {
	return {
		async read() {
			const value = await request({
				path: RECOVERY_SUMMARY_PATH,
				method: 'GET',
			});
			return parseRecoverySummary(value);
		},
	};
}
