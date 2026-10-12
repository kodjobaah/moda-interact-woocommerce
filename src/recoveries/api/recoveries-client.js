import apiFetch from '@wordpress/api-fetch';
import {
	parseRecoveriesResponse,
	RECOVERY_FILTERS,
	RECOVERY_PAGE_SIZES,
} from './recoveries-contract';

export const RECOVERIES_REST_PATH = '/moda-interact/v1/merchant/recoveries';

/**
 * Authenticated WordPress REST only; installation credentials never enter the browser.
 * @param {(options: Object) => Promise<Object>} request
 */
export function createRecoveriesClient(request = apiFetch) {
	return {
		async list(filters, signal) {
			const { page = 1, pageSize = 25, from, to, q, status } = filters;
			if (
				!Number.isSafeInteger(page) ||
				page < 1 ||
				page > 9999 ||
				!RECOVERY_PAGE_SIZES.includes(pageSize) ||
				(from !== undefined &&
					(typeof from !== 'string' ||
						!/^\d{4}-\d{2}-\d{2}$/.test(from))) ||
				(to !== undefined &&
					(typeof to !== 'string' ||
						!/^\d{4}-\d{2}-\d{2}$/.test(to))) ||
				(q !== undefined &&
					(typeof q !== 'string' || [...q].length > 100)) ||
				(status !== undefined && !RECOVERY_FILTERS.includes(status))
			) {
				throw new Error('invalid_request');
			}
			const query = new URLSearchParams({
				page: String(page),
				pageSize: String(pageSize),
			});
			for (const [key, value] of Object.entries({
				from,
				to,
				q,
				status,
			})) {
				if (value !== undefined) {
					query.set(key, value);
				}
			}
			try {
				const response = await request({
					path: `${RECOVERIES_REST_PATH}?${query}`,
					method: 'GET',
					signal,
				});
				const result = parseRecoveriesResponse(response);
				if (
					result.page > page ||
					result.pageSize !== pageSize ||
					(from !== undefined && result.from !== from) ||
					(to !== undefined && result.to !== to) ||
					(q !== undefined && result.q !== q.trim()) ||
					(status !== undefined && result.status !== status)
				) {
					throw new Error('remote_response_invalid');
				}
				return result;
			} catch (error) {
				if (signal?.aborted) {
					throw error;
				}
				// Do not expose response bodies, provider errors or credentials to presentation.
				const code = error?.code ?? error?.message;
				throw new Error(
					code === 'invalid_request' ? code : 'remote_unavailable'
				);
			}
		},
	};
}
