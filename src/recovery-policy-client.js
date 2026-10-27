import apiFetch from '@wordpress/api-fetch';

export const RECOVERY_POLICY_PATH =
	'/moda-interact/v1/merchant/recovery-policy';

const ERROR_CODES = new Set([
	'POLICY_CONFLICT',
	'OFFER_UNSUPPORTED',
	'POLICY_UNAVAILABLE',
	'RECONNECT_REQUIRED',
	'SITE_URL_CHANGED',
	'LOCAL_STATE_INVALID',
	'INVALID_REQUEST',
	'API_NOT_CONFIGURED',
	'REMOTE_RESPONSE_INVALID',
	'REMOTE_UNAVAILABLE',
]);

function exact(value, fields) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).length === fields.length &&
		fields.every((key) => Object.hasOwn(value, key))
	);
}

function policy(value) {
	return (
		exact(value, [
			'recoveryDelayMinutes',
			'recoveryOfferMode',
			'followUpEnabled',
			'followUpDelayMinutes',
		]) &&
		Number.isInteger(value.recoveryDelayMinutes) &&
		value.recoveryDelayMinutes >= 0 &&
		value.recoveryDelayMinutes <= 10080 &&
		['NONE', 'FIXED', 'AI_BEST_APPLICABLE'].includes(
			value.recoveryOfferMode
		) &&
		typeof value.followUpEnabled === 'boolean' &&
		(value.followUpEnabled
			? Number.isInteger(value.followUpDelayMinutes) &&
				value.followUpDelayMinutes >= 1 &&
				value.followUpDelayMinutes <= 10080
			: value.followUpDelayMinutes === null)
	);
}

/**
 * Reject fields not owned by the Woo policy API, including Shopify coupon IDs.
 *
 * @param {unknown} input Hosted API response.
 * @return {Object} Strict validated policy projection.
 */
export function parseMerchantRecoveryPolicy(input) {
	if (
		!exact(input, [
			'schemaVersion',
			'revision',
			'merchant',
			'effective',
			'source',
			'overrideActive',
			'offerSelectionAvailable',
			'notifyOnInitialRecoveryOutreach',
		]) ||
		input.schemaVersion !== 2 ||
		typeof input.revision !== 'string' ||
		!(
			input.revision === 'UNCONFIGURED' ||
			(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
				input.revision
			) &&
				Number.isFinite(Date.parse(input.revision)))
		) ||
		!policy(input.merchant) ||
		!policy(input.effective) ||
		!['MERCHANT', 'ADMIN_OVERRIDE'].includes(input.source) ||
		typeof input.overrideActive !== 'boolean' ||
		input.overrideActive !== (input.source === 'ADMIN_OVERRIDE') ||
		input.offerSelectionAvailable !== false ||
		typeof input.notifyOnInitialRecoveryOutreach !== 'boolean'
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return input;
}

/**
 * Convert the validated local draft into the exact five-field PUT body.
 *
 * @param {Object} current Persisted merchant policy response.
 * @param {Object} draft   Current form input values.
 * @return {Object} API-002 revision-checked update.
 */
export function makeRecoveryPolicyUpdate(current, draft) {
	if (!current || current.merchant.recoveryOfferMode !== 'NONE') {
		throw new Error('OFFER_UNSUPPORTED');
	}
	const start = Number(draft.recoveryDelayMinutes);
	const followUp = draft.followUpEnabled
		? Number(draft.followUpDelayMinutes)
		: null;
	if (
		!/^(?:0|[1-9]\d*)$/.test(draft.recoveryDelayMinutes) ||
		typeof draft.followUpEnabled !== 'boolean' ||
		typeof draft.notifyOnInitialRecoveryOutreach !== 'boolean' ||
		!Number.isInteger(start) ||
		start < 0 ||
		start > 10080 ||
		(draft.followUpEnabled &&
			(!/^(?:0|[1-9]\d*)$/.test(draft.followUpDelayMinutes) ||
				!Number.isInteger(followUp) ||
				followUp < 60 ||
				followUp > 10080))
	) {
		throw new Error('INVALID_REQUEST');
	}
	return {
		expectedRevision: current.revision,
		recoveryDelayMinutes: start,
		followUpEnabled: draft.followUpEnabled,
		followUpDelayMinutes: followUp,
		notifyOnInitialRecoveryOutreach:
			draft.notifyOnInitialRecoveryOutreach,
	};
}

function mapError(error) {
	const code = error?.data?.status ?? error?.status ?? error?.message;
	return new Error(ERROR_CODES.has(code) ? code : 'REMOTE_UNAVAILABLE');
}

/** @param {(options: Object) => Promise<Object>} request WordPress REST transport. */
export function createRecoveryPolicyClient(request = apiFetch) {
	return {
		async read() {
			try {
				return parseMerchantRecoveryPolicy(
					await request({ path: RECOVERY_POLICY_PATH, method: 'GET' })
				);
			} catch (error) {
				throw mapError(error);
			}
		},
		/** @param {Object} update Strict API-002 update. */
		async save(update) {
			try {
				const result = parseMerchantRecoveryPolicy(
					await request({
						path: RECOVERY_POLICY_PATH,
						method: 'PUT',
						data: update,
					})
				);
				if (
					result.merchant.recoveryDelayMinutes !==
						update.recoveryDelayMinutes ||
					result.merchant.followUpEnabled !==
						update.followUpEnabled ||
					result.merchant.followUpDelayMinutes !==
						update.followUpDelayMinutes ||
					result.notifyOnInitialRecoveryOutreach !==
						update.notifyOnInitialRecoveryOutreach
				) {
					throw new Error('REMOTE_RESPONSE_INVALID');
				}
				return result;
			} catch (error) {
				throw mapError(error);
			}
		},
	};
}
