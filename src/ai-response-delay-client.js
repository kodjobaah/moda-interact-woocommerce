import apiFetch from '@wordpress/api-fetch';

export const AI_RESPONSE_DELAY_PATH =
	'/moda-interact/v1/merchant/ai-response-delay';

const ERROR_CODES = new Set([
	'AI_RESPONSE_DELAY_CONFLICT',
	'AI_RESPONSE_DELAY_UNAVAILABLE',
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

function validRevision(revision) {
	return (
		typeof revision === 'string' &&
		(revision === 'UNCONFIGURED' ||
			(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(revision) &&
				Number.isFinite(Date.parse(revision))))
	);
}

export function parseAiResponseDelay(value) {
	if (
		!exact(value, [
			'schemaVersion',
			'revision',
			'aiResponseDelayMinutes',
		]) ||
		value.schemaVersion !== 1 ||
		!validRevision(value.revision) ||
		!Number.isInteger(value.aiResponseDelayMinutes) ||
		value.aiResponseDelayMinutes < 0 ||
		value.aiResponseDelayMinutes > 30
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return value;
}

export function makeAiResponseDelayUpdate(current, draft) {
	if (!current || !validRevision(current.revision)) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	const value = draft.aiResponseDelayMinutes;
	if (
		typeof value !== 'string' ||
		!/^(?:0|[1-9]\d*)$/.test(value) ||
		!Number.isInteger(Number(value)) ||
		Number(value) < 0 ||
		Number(value) > 30
	) {
		throw new Error('INVALID_REQUEST');
	}
	return {
		schemaVersion: 1,
		expectedRevision: current.revision,
		aiResponseDelayMinutes: Number(value),
	};
}

function mapError(error) {
	const code = error?.data?.status ?? error?.status ?? error?.message;
	return new Error(ERROR_CODES.has(code) ? code : 'REMOTE_UNAVAILABLE');
}

/** @param {(options: Object) => Promise<Object>} request WordPress REST transport. */
export function createAiResponseDelayClient(request = apiFetch) {
	async function read() {
		try {
			return parseAiResponseDelay(
				await request({ path: AI_RESPONSE_DELAY_PATH, method: 'GET' })
			);
		} catch (error) {
			throw mapError(error);
		}
	}

	return {
		read,
		async save(update) {
			let response;
			try {
				response = parseAiResponseDelay(
					await request({
						path: AI_RESPONSE_DELAY_PATH,
						method: 'PUT',
						data: update,
					})
				);
			} catch (error) {
				const mapped = mapError(error);
				if (mapped.message === 'REMOTE_UNAVAILABLE') {
					// A timed-out PUT may have committed. Confirm only from a fresh GET.
					try {
						const canonical = await read();
						if (
							canonical.aiResponseDelayMinutes ===
							update.aiResponseDelayMinutes
						) {
							return canonical;
						}
					} catch {
						// Keep the sanitized write failure and the old UI state.
					}
				}
				throw mapped;
			}
			if (
				response.aiResponseDelayMinutes !==
				update.aiResponseDelayMinutes
			) {
				throw new Error('REMOTE_RESPONSE_INVALID');
			}
			const canonical = await read();
			if (
				canonical.aiResponseDelayMinutes !==
				update.aiResponseDelayMinutes
			) {
				throw new Error('REMOTE_RESPONSE_INVALID');
			}
			return canonical;
		},
	};
}
