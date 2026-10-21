// Safe error categories for the privileged WordPress REST broker. Never display
// upstream exception messages, which may contain installation details.
const CODES = new Set([
	'DENIED',
	'FORBIDDEN',
	'CONFLICT',
	'RECONNECT_REQUIRED',
	'SITE_URL_CHANGED',
	'LOCAL_STATE_INVALID',
	'API_NOT_CONFIGURED',
	'REMOTE_UNAVAILABLE',
	'INVALID_REQUEST',
	'REQUEST_TOO_LARGE',
	'NOT_FOUND',
]);

export function merchantRestError(error, unavailable = 'REMOTE_UNAVAILABLE') {
	if (error?.name === 'AbortError' || error?.code === 'ABORTED') {
		return Object.assign(new Error('ABORTED'), { code: 'ABORTED' });
	}
	const candidates = [
		error?.code,
		error?.data?.status,
		error?.status,
		error?.message,
	];
	const declared = candidates.find(
		(value) => typeof value === 'string' && CODES.has(value)
	);
	const numeric = candidates.find((value) => Number.isInteger(value));
	let code = declared ?? unavailable;
	if (declared === undefined) {
		if (numeric === 401) {
			code = 'RECONNECT_REQUIRED';
		} else if (numeric === 403) {
			code = 'DENIED';
		} else if (numeric === 409) {
			code = 'CONFLICT';
		}
	}
	return Object.assign(new Error(code), { code });
}
