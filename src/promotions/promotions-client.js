import apiFetch from '@wordpress/api-fetch';
import { merchantRestError } from '../recovery-settings/merchant-rest-errors';
import {
	parsePromotionSelection,
	parsePromotionsResponse,
	validCampaignId,
	validPromotionPage,
	validRevision,
} from './promotions-contract';

export const PROMOTIONS_PATH = '/moda-interact/v1/merchant/promotions';

// Only the same-origin, WordPress nonce-authenticated API. Never expose a
// hosted installation credential, shop ID or a browser-selectable upstream URL.
export function createPromotionsClient(request = apiFetch) {
	function errorFrom(error, signal) {
		if (signal?.aborted) {
			return Object.assign(new Error('ABORTED'), { code: 'ABORTED' });
		}
		if (error?.message === 'REMOTE_RESPONSE_INVALID') {
			return Object.assign(new Error('REMOTE_RESPONSE_INVALID'), {
				code: 'REMOTE_RESPONSE_INVALID',
			});
		}
		return merchantRestError(error);
	}
	return {
		async read({ offerPage = 1, historyPage = 1 }, signal) {
			if (
				!validPromotionPage(offerPage) ||
				!validPromotionPage(historyPage)
			) {
				throw new Error('INVALID_REQUEST');
			}
			const query = new URLSearchParams({
				offerPage: String(offerPage),
				historyPage: String(historyPage),
			});
			try {
				const response = await request({
					path: `${PROMOTIONS_PATH}?${query}`,
					method: 'GET',
					signal,
				});
				if (signal?.aborted) {
					throw new Error('ABORTED');
				}
				const data = parsePromotionsResponse(response);
				if (
					data.offersPagination.page > offerPage ||
					data.history.page > historyPage
				) {
					throw new Error('REMOTE_RESPONSE_INVALID');
				}
				return data;
			} catch (error) {
				throw errorFrom(error, signal);
			}
		},
		async select(campaignId, expectedRevision, signal) {
			if (
				!validCampaignId(campaignId) ||
				!validRevision(expectedRevision)
			) {
				throw new Error('INVALID_REQUEST');
			}
			try {
				const response = await request({
					path: `${PROMOTIONS_PATH}/selection`,
					method: 'PUT',
					data: { campaignId, expectedRevision },
					signal,
				});
				if (signal?.aborted) {
					throw new Error('ABORTED');
				}
				return parsePromotionSelection(response, campaignId);
			} catch (error) {
				throw errorFrom(error, signal);
			}
		},
	};
}
