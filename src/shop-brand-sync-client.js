import apiFetch from '@wordpress/api-fetch';
import { merchantRestError } from './recovery-settings/merchant-rest-errors';

export const SHOP_BRAND_SYNC_PATH = '/moda-interact/v1/merchant/shop-brand/sync';
const STATUSES = new Set([ 'NEVER_SYNCED', 'QUEUED', 'RETRYING', 'ACCEPTED', 'FAILED' ]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function parseShopBrandStatus(value) {
	if ( value === null || typeof value !== 'object' || Array.isArray(value) ||
		Object.keys(value).length !== 3 || ![ 'status', 'lastRequestedAt', 'lastAcceptedAt' ].every((key) => Object.hasOwn(value, key)) ||
		!STATUSES.has(value.status) || ![ value.lastRequestedAt, value.lastAcceptedAt ].every((stamp) =>
			stamp === null || (typeof stamp === 'string' && ISO_UTC.test(stamp) && Number.isFinite(Date.parse(stamp))) ) ) {
		throw Object.assign(new Error('SHOP_BRAND_STATUS_INVALID'), { code: 'SHOP_BRAND_STATUS_INVALID' });
	}
	return value;
}

export function createShopBrandSyncClient(request = apiFetch) {
	return {
		async read(options = {}) {
			try {
				return parseShopBrandStatus(await request({ path: SHOP_BRAND_SYNC_PATH, method: 'GET', signal: options.signal }));
			} catch (error) {
				if (error?.code === 'SHOP_BRAND_STATUS_INVALID') throw error;
				throw merchantRestError(error, 'SYNC_STATUS_UNAVAILABLE');
			}
		},
		async requestSync(options = {}) {
			try {
				const result = await request({ path: SHOP_BRAND_SYNC_PATH, method: 'POST', signal: options.signal });
				if (result === null || typeof result !== 'object' || Object.keys(result).length !== 1 ||
					!['QUEUED', 'ALREADY_QUEUED'].includes(result.status)) {
					throw Object.assign(new Error('SHOP_BRAND_COMMAND_INVALID'), { code: 'SHOP_BRAND_COMMAND_INVALID' });
				}
				return result;
			} catch (error) {
				if (error?.code === 'SHOP_BRAND_COMMAND_INVALID') throw error;
				throw merchantRestError(error, 'SYNC_UNAVAILABLE');
			}
		},
	};
}
