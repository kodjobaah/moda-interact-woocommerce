import apiFetch from '@wordpress/api-fetch';

export const READ_ACCESS_PATH = '/moda-interact/v1/connection/read-access';
const VALID_GRANTS = new Set([
	'CONNECTED',
	'PENDING',
	'NOT_CONNECTED',
	'REAUTHORIZATION_REQUIRED',
]);

function exactKeys(object, expected) {
	return (
		object !== null &&
		typeof object === 'object' &&
		!Array.isArray(object) &&
		Object.keys(object).sort().join('|') === expected.sort().join('|')
	);
}

export function parseReadAccessStatus(value) {
	if (
		!exactKeys(value, [
			'schemaVersion',
			'status',
			'providerRevocationRequired',
		]) ||
		value.schemaVersion !== 1 ||
		!VALID_GRANTS.has(value.status) ||
		typeof value.providerRevocationRequired !== 'boolean' ||
		(value.status === 'CONNECTED' && value.providerRevocationRequired)
	) {
		throw new Error('invalid_read_access_response');
	}
	return {
		grantStatus: value.status,
		providerRevocationRequired: value.providerRevocationRequired,
	};
}

export function parseReadAccessStart(value, canonicalSiteUrl) {
	if (
		!exactKeys(value, ['schemaVersion', 'authorizationUrl', 'expiresAt']) ||
		value.schemaVersion !== 1 ||
		typeof value.authorizationUrl !== 'string' ||
		value.authorizationUrl.length > 2048 ||
		typeof value.expiresAt !== 'string' ||
		!Number.isFinite(Date.parse(value.expiresAt))
	) {
		throw new Error('invalid_read_access_response');
	}
	try {
		const target = new URL(value.authorizationUrl);
		const shop = new URL(canonicalSiteUrl);
		const basePath = shop.pathname.replace(/\/$/, '');
		if (
			target.origin !== shop.origin ||
			target.pathname !== `${basePath}/wc-auth/v1/authorize` ||
			target.searchParams.get('scope') !== 'read' ||
			target.username ||
			target.password ||
			target.hash
		) {
			throw new Error('invalid_read_access_response');
		}
	} catch {
		throw new Error('invalid_read_access_response');
	}
	return value.authorizationUrl;
}

export function createReadAccessClient(request = apiFetch) {
	return {
		async getStatus() {
			return parseReadAccessStatus(
				await request({ path: READ_ACCESS_PATH, method: 'GET' })
			);
		},
		async start(canonicalSiteUrl) {
			return parseReadAccessStart(
				await request({
					path: `${READ_ACCESS_PATH}/authorize`,
					method: 'POST',
				}),
				canonicalSiteUrl
			);
		},
		async revoke() {
			const result = await request({ path: READ_ACCESS_PATH, method: 'DELETE' });
			if (
				!exactKeys(result, [
					'schemaVersion',
					'status',
					'providerRevocationRequired',
				]) ||
				result.schemaVersion !== 1 ||
				result.status !== 'REVOKED' ||
				result.providerRevocationRequired !== true
			) {
				throw new Error('invalid_read_access_response');
			}
			return { grantStatus: 'REAUTHORIZATION_REQUIRED', providerRevocationRequired: true };
		},
	};
}
