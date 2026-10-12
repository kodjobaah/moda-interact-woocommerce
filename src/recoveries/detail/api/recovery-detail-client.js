import apiFetch from '@wordpress/api-fetch';
import {
	parseRecoveryDetailResponse,
	validCursor,
	validRecoveryId,
} from './recovery-detail-contract';

export const RECOVERY_DETAIL_REST_PATH =
	'/moda-interact/v1/merchant/recoveries';

/**
 * WordPress nonce-authenticated REST; never a browser-to-hosted-API connection.
 * @param {(options: Object) => Promise<Object>} request
 */
export function createRecoveryDetailClient(request = apiFetch) {
	async function read(id, section, navigation, signal) {
		if (
			!validRecoveryId(id) ||
			!['summary', 'messages', 'related'].includes(section)
		) {
			throw new Error('invalid_request');
		}
		const query = new URLSearchParams();
		if (section === 'summary' && navigation) {
			throw new Error('invalid_request');
		}
		if (section !== 'summary' && navigation) {
			if (navigation.cursor) {
				if (!validCursor(navigation.cursor) || navigation.window) {
					throw new Error('invalid_request');
				}
				query.set('cursor', navigation.cursor);
			} else if (navigation.window) {
				if (
					section !== 'messages' ||
					!['first', 'latest'].includes(navigation.window)
				) {
					throw new Error('invalid_request');
				}
				query.set('window', navigation.window);
			}
		}
		const path =
			`${RECOVERY_DETAIL_REST_PATH}/${encodeURIComponent(id)}` +
			(section === 'summary' ? '' : `/${section}`) +
			(query.size ? `?${query}` : '');
		try {
			const response = await request({ path, method: 'GET', signal });
			const parsed = parseRecoveryDetailResponse(section, response);
			if (section === 'summary' && parsed.id !== id) {
				throw new Error('remote_response_invalid');
			}
			return parsed;
		} catch (error) {
			if (signal?.aborted) {
				throw error;
			}
			const code = error?.data?.status ?? error?.code ?? error?.message;
			throw new Error(
				code === 'RECOVERY_NOT_FOUND' || code === 404
					? 'not_found'
					: 'remote_unavailable'
			);
		}
	}
	return {
		summary: (id, signal) => read(id, 'summary', null, signal),
		messages: (id, navigation, signal) =>
			read(id, 'messages', navigation, signal),
		related: (id, navigation, signal) =>
			read(id, 'related', navigation, signal),
	};
}
