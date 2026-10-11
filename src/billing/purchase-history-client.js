import apiFetch from '@wordpress/api-fetch';
import {
	HISTORY_FILTERS,
	HISTORY_PAGE_SIZES,
	parsePurchaseHistory,
} from './purchase-history-contract';

const ERRORS = new Set([
	'RECONNECT_REQUIRED',
	'SITE_URL_CHANGED',
	'LOCAL_STATE_INVALID',
	'remote_authentication_failed',
	'remote_unavailable',
	'remote_response_invalid',
	'billing_not_initialized',
]);

/**
 * Browser -> WordPress REST, never directly to hosted Moda or WooCommerce.
 * @param {(options: Object) => Promise<Object>} request - Authenticated WordPress REST transport.
 */
export function createPurchaseHistoryClient(request = apiFetch) {
	return {
		async getHistory(filter, page, pageSize, signal) {
			if (
				!HISTORY_FILTERS.includes(filter) ||
				!Number.isSafeInteger(page) ||
				page < 1 ||
				!HISTORY_PAGE_SIZES.includes(pageSize)
			) {
				throw new Error('invalid_request');
			}
			const query = new URLSearchParams({
				filter,
				page: String(page),
				pageSize: String(pageSize),
			});
			try {
				const response = await request({
					path: `/moda-interact/v1/billing/recovery-credit-purchases?${query}`,
					method: 'GET',
					signal,
				});
				const data = parsePurchaseHistory(response);
				if (data.filter !== filter || data.pageSize !== pageSize) {
					throw new Error('remote_response_invalid');
				}
				return data;
			} catch (error) {
				if (signal?.aborted) {
					throw error;
				}
				const code = error?.error ?? error?.code ?? error?.message;
				throw new Error(ERRORS.has(code) ? code : 'remote_unavailable');
			}
		},
	};
}
