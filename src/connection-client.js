import apiFetch from '@wordpress/api-fetch';

export const CONNECTION_PATH = '/moda-interact/v1/connection';

const STATUS_ONLY = new Set([
	'DISCONNECTED',
	'RECONNECT_REQUIRED',
	'SITE_URL_CHANGED',
	'REMOTE_UNAVAILABLE',
	'API_NOT_CONFIGURED',
	'LOCAL_STATE_INVALID',
]);

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalSiteUrl(value) {
	if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
		return false;
	}
	try {
		const url = new URL(value);
		return (
			['http:', 'https:'].includes(url.protocol) &&
			url.username === '' &&
			url.password === '' &&
			url.search === '' &&
			url.hash === '' &&
			!value.endsWith('/')
		);
	} catch {
		return false;
	}
}

function hasSafeConnectionMetadata(payload) {
	return (
		typeof payload.installationId === 'string' &&
		payload.installationId.length > 0 &&
		typeof payload.shopId === 'string' &&
		payload.shopId.length > 0 &&
		isCanonicalSiteUrl(payload.canonicalSiteUrl) &&
		Number.isInteger(payload.credentialVersion) &&
		payload.credentialVersion > 0
	);
}

export function parseConnectionStatus(payload) {
	if (!isRecord(payload) || typeof payload.status !== 'string') {
		throw new Error('invalid_connection_response');
	}

	if (STATUS_ONLY.has(payload.status)) {
		if (Object.keys(payload).length !== 1) {
			throw new Error('invalid_connection_response');
		}
		return { status: payload.status };
	}

	if (
		payload.status !== 'CONNECTED' ||
		Object.keys(payload).length !== 5 ||
		!hasSafeConnectionMetadata(payload)
	) {
		throw new Error('invalid_connection_response');
	}

	return {
		status: 'CONNECTED',
		installationId: payload.installationId,
		shopId: payload.shopId,
		canonicalSiteUrl: payload.canonicalSiteUrl,
		credentialVersion: payload.credentialVersion,
	};
}

export function parseConnectionCommand(payload) {
	if (
		!isRecord(payload) ||
		payload.status !== 'CONNECTED' ||
		Object.keys(payload).length !== 6 ||
		!hasSafeConnectionMetadata(payload) ||
		!['CREATED', 'RECONNECTED'].includes(payload.connection)
	) {
		throw new Error('invalid_connection_response');
	}

	return {
		status: 'CONNECTED',
		installationId: payload.installationId,
		shopId: payload.shopId,
		canonicalSiteUrl: payload.canonicalSiteUrl,
		credentialVersion: payload.credentialVersion,
	};
}

export function createConnectionClient(request = apiFetch) {
	return {
		async getStatus() {
			try {
				return parseConnectionStatus(
					await request({ path: CONNECTION_PATH, method: 'GET' })
				);
			} catch (error) {
				try {
					return parseConnectionStatus(error);
				} catch {
					throw new Error('connection_request_failed');
				}
			}
		},
		async connect() {
			return parseConnectionCommand(
				await request({ path: CONNECTION_PATH, method: 'POST' })
			);
		},
	};
}
