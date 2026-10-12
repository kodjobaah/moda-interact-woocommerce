import apiFetch from '@wordpress/api-fetch';

export const COUPON_PREVIEW_PATH =
	'/moda-interact/v1/merchant/recovery-coupons';
const STATUSES = new Set([
	'REVIEW_REQUIRED',
	'RESTRICTED',
	'EXPIRED',
	'EXHAUSTED',
	'UNSUPPORTED',
]);

function exact(value, keys) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

/**
 * @param {unknown} input REST response.
 * @return {Object} Validated page; unknown fields are never passed to React.
 */
export function parseCouponPreview(input) {
	if (
		!exact(input, [
			'schemaVersion',
			'page',
			'pageSize',
			'total',
			'totalPages',
			'items',
		]) ||
		input.schemaVersion !== 1 ||
		!Number.isInteger(input.page) ||
		input.page < 1 ||
		input.page > 9999 ||
		input.pageSize !== 10 ||
		!Number.isInteger(input.total) ||
		input.total < 0 ||
		!Number.isInteger(input.totalPages) ||
		input.totalPages < 1 ||
		!Array.isArray(input.items) ||
		input.items.length > 10 ||
		input.items.some(
			(item) =>
				!exact(item, [
					'id',
					'code',
					'type',
					'amount',
					'currency',
					'previewStatus',
				]) ||
				!Number.isInteger(item.id) ||
				item.id < 1 ||
				typeof item.code !== 'string' ||
				item.code.length > 256 ||
				!['percent', 'fixed_cart', 'fixed_product', 'other'].includes(
					item.type
				) ||
				typeof item.amount !== 'string' ||
				!/^(?:\d+)(?:\.\d{1,8})?$/.test(item.amount) ||
				typeof item.currency !== 'string' ||
				!/^[A-Z]{3}$/.test(item.currency) ||
				!STATUSES.has(item.previewStatus)
		)
	) {
		throw new Error('COUPONS_UNAVAILABLE');
	}
	return input;
}

/** @param {(options: Object) => Promise<Object>} request WordPress REST transport. */
export function createCouponPreviewClient(request = apiFetch) {
	return {
		/**
		 * @param {Object} root0
		 * @param {number} root0.page
		 * @param {string} root0.q
		 * @return {Promise<Object>} Strict server page.
		 */
		async read({ page = 1, q = '' } = {}) {
			if (
				!Number.isInteger(page) ||
				page < 1 ||
				page > 9999 ||
				typeof q !== 'string' ||
				q.length > 80
			) {
				throw new Error('INVALID_REQUEST');
			}
			const params = new URLSearchParams({ page: String(page), q });
			try {
				return parseCouponPreview(
					await request({
						path: `${COUPON_PREVIEW_PATH}?${params.toString()}`,
						method: 'GET',
					})
				);
			} catch {
				throw new Error('COUPONS_UNAVAILABLE');
			}
		},
	};
}
