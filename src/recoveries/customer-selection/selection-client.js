import apiFetch from '@wordpress/api-fetch';
import {
	isCanonicalPhone,
	makeSelectionCommand,
	parseSelectionStatus,
	SELECTION_PATH,
} from './selection-contract';

const errors = new Set([
	'INVALID_REQUEST',
	'FORBIDDEN',
	'RECONNECT_REQUIRED',
	'LOCAL_STATE_INVALID',
	'SITE_URL_CHANGED',
	'CUSTOMER_PHONE_NOT_FOUND',
	'AMBIGUOUS_CUSTOMER_PHONE',
	'STALE_NO_CONTACT_REVISION',
	'CUSTOMER_CONSENT_REQUIRED',
	'CUSTOMER_STOP_AUTHORITATIVE',
	'SELECTION_UNAVAILABLE',
	'REMOTE_RESPONSE_INVALID',
]);
function selectionError(error) {
	const candidates = [error?.data?.status, error?.status, error?.code, error?.message];
	const code = candidates.find((value) => typeof value === 'string' && errors.has(value));
	if (code) return new Error(code);
	const httpStatus = candidates.find((value) => typeof value === 'number');
	const fallback = { 400: 'INVALID_REQUEST', 401: 'RECONNECT_REQUIRED',
		403: 'FORBIDDEN', 404: 'CUSTOMER_PHONE_NOT_FOUND' };
	return new Error(fallback[httpStatus] ?? 'REMOTE_UNAVAILABLE');
}

/** Browser calls only the WP nonce-authenticated REST route. */
export function createSelectionClient(request = apiFetch) {
	return Object.freeze({
		async lookup(phone, signal) {
			if (!isCanonicalPhone(phone)) throw new Error('INVALID_REQUEST');
			try {
				const result = await request({
					path: `${SELECTION_PATH}?canonicalPhone=${encodeURIComponent(phone)}`,
					method: 'GET',
					signal,
				});
				return parseSelectionStatus(result);
			} catch (error) { throw selectionError(error); }
		},
		async execute(status, phone, action, evidenceReference, signal) {
			const data = makeSelectionCommand(status, phone, action, evidenceReference);
			try {
				const result = await request({
					path: SELECTION_PATH,
					method: 'POST',
					data,
					signal,
				});
				return parseSelectionStatus(result, true);
			} catch (error) { throw selectionError(error); }
		},
	});
}
