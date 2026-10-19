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
	const code =
		declared ??
		(numeric === 401
			? 'RECONNECT_REQUIRED'
			: numeric === 403
				? 'DENIED'
				: numeric === 409
					? 'CONFLICT'
					: unavailable);
	return Object.assign(new Error(code), { code });
}
