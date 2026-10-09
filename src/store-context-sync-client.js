import apiFetch from '@wordpress/api-fetch';

export const STORE_CONTEXT_SYNC_PATH =
	'/moda-interact/v1/merchant/store-context/sync';

export function createStoreContextSyncClient(request = apiFetch) {
	return {
		async sync() {
			const result = await request({
				path: STORE_CONTEXT_SYNC_PATH,
				method: 'POST',
			});
			if (
				!result ||
				typeof result !== 'object' ||
				Array.isArray(result) ||
				Object.keys(result).length !== 1 ||
				result.status !== 'SYNCED'
			) {
				throw new Error('STORE_CONTEXT_SYNC_FAILED');
			}
		},
	};
}
