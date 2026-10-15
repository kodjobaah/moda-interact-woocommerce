import apiFetch from '@wordpress/api-fetch';

export const OFFER_PATH = '/moda-interact/v1/merchant/discount-offers';
export const CATALOGUE_PATH = '/moda-interact/v1/merchant/discount-catalogue';
export const OFFER_MODES = ['NONE', 'FIXED', 'AI_BEST_APPLICABLE'];
const ID = /^[A-Za-z0-9_-]{1,128}$/;

function object(value, fields) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).sort().join(',') === [...fields].sort().join(',')
	);
}

function selected(value) {
	return (
		Array.isArray(value) &&
		value.length <= 50 &&
		value.every((id) => typeof id === 'string' && ID.test(id)) &&
		new Set(value).size === value.length
	);
}

export function parseOffers(value) {
	if (
		!object(value, [
			'schemaVersion',
			'revision',
			'merchant',
			'effective',
			'source',
			'overrideActive',
		]) ||
		value.schemaVersion !== 1 ||
		typeof value.revision !== 'string' ||
		value.revision.length > 1024 ||
		!object(value.merchant, ['recoveryOfferMode', 'selectedDiscountIds']) ||
		!OFFER_MODES.includes(value.merchant.recoveryOfferMode) ||
		!selected(value.merchant.selectedDiscountIds) ||
		!object(value.effective, ['recoveryOfferMode']) ||
		!OFFER_MODES.includes(value.effective.recoveryOfferMode) ||
		!['MERCHANT', 'ADMIN_OVERRIDE'].includes(value.source) ||
		typeof value.overrideActive !== 'boolean' ||
		value.overrideActive !== (value.source === 'ADMIN_OVERRIDE')
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return value;
}

export function parseCatalogue(value) {
	if (
		!object(value, [
			'schemaVersion',
			'revision',
			'items',
			'nextCursor',
			'hasMore',
		]) ||
		value.schemaVersion !== 1 ||
		typeof value.revision !== 'string' ||
		value.revision.length > 1024 ||
		typeof value.hasMore !== 'boolean' ||
		(value.nextCursor !== null &&
			(typeof value.nextCursor !== 'string' ||
				!ID.test(value.nextCursor))) ||
		value.hasMore !== (value.nextCursor !== null) ||
		!Array.isArray(value.items) ||
		value.items.length > 25 ||
		value.items.some(
			(item) =>
				!object(item, [
					'id',
					'title',
					'summary',
					'providerType',
					'code',
					'startsAt',
					'endsAt',
					'selected',
				]) ||
				!ID.test(item.id) ||
				typeof item.title !== 'string' ||
				item.title.length > 512 ||
				(item.summary !== null &&
					(typeof item.summary !== 'string' ||
						item.summary.length > 2048)) ||
				!/^WooCoupon:(percent|fixed_cart|fixed_product)$/.test(
					item.providerType
				) ||
				(item.code !== null &&
					(typeof item.code !== 'string' ||
						item.code.length > 256)) ||
				!['startsAt', 'endsAt'].every(
					(name) =>
						item[name] === null ||
						(typeof item[name] === 'string' &&
							Number.isFinite(Date.parse(item[name])))
				) ||
				typeof item.selected !== 'boolean'
		) ||
		(value.hasMore && value.items.length === 0)
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return value;
}

export function validateOfferUpdate({
	recoveryOfferMode,
	selectedDiscountIds,
}) {
	if (
		!OFFER_MODES.includes(recoveryOfferMode) ||
		!selected(selectedDiscountIds) ||
		(recoveryOfferMode === 'FIXED' && selectedDiscountIds.length === 0)
	) {
		throw new Error('INVALID_SELECTION');
	}
	return {
		recoveryOfferMode,
		selectedDiscountIds: [...selectedDiscountIds].sort(),
	};
}

function mapError(error) {
	const code = [
		error?.code,
		error?.data?.status,
		error?.status,
		error?.message,
	].find(
		(value) =>
			typeof value === 'string' &&
			[
				'CATALOGUE_NOT_CURRENT',
				'catalogue_not_current',
				'RECONNECT_REQUIRED',
				'OFFERS_CONFLICT',
				'offers_conflict',
				'SELECTED_COUPON_NOT_FOUND',
				'selected_coupon_not_found',
				'SELECTION_REQUIRED',
				'selection_required',
				'SELECTION_LIMIT_EXCEEDED',
				'selection_limit_exceeded',
			].includes(value)
	);
	return new Error(
		[
			'CATALOGUE_NOT_CURRENT',
			'catalogue_not_current',
			'RECONNECT_REQUIRED',
			'OFFERS_CONFLICT',
			'offers_conflict',
			'SELECTED_COUPON_NOT_FOUND',
			'selected_coupon_not_found',
			'SELECTION_REQUIRED',
			'selection_required',
			'SELECTION_LIMIT_EXCEEDED',
			'selection_limit_exceeded',
		].includes(code)
			? String(code).toUpperCase()
			: 'REMOTE_UNAVAILABLE'
	);
}

export function createMerchantOffersClient(request = apiFetch) {
	return {
		async readOffers() {
			try {
				return parseOffers(
					await request({ path: OFFER_PATH, method: 'GET' })
				);
			} catch (error) {
				throw mapError(error);
			}
		},
		async readCatalogue({ cursor = null, search = '' } = {}) {
			if (
				(cursor !== null && !ID.test(cursor)) ||
				typeof search !== 'string' ||
				search.length > 80
			) {
				throw new Error('INVALID_REQUEST');
			}
			const params = new URLSearchParams({ limit: '25' });
			if (cursor) {
				params.set('cursor', cursor);
			}
			if (search.trim()) {
				params.set('search', search.trim());
			}
			try {
				return parseCatalogue(
					await request({
						path: `${CATALOGUE_PATH}?${params}`,
						method: 'GET',
					})
				);
			} catch (error) {
				throw mapError(error);
			}
		},
		async saveOffers(draft) {
			const data = validateOfferUpdate(draft);
			try {
				const response = parseOffers(
					await request({ path: OFFER_PATH, method: 'PUT', data })
				);
				if (
					response.merchant.recoveryOfferMode !==
						data.recoveryOfferMode ||
					JSON.stringify(
						[...response.merchant.selectedDiscountIds].sort()
					) !== JSON.stringify(data.selectedDiscountIds)
				) {
					throw new Error('REMOTE_RESPONSE_INVALID');
				}
				return response;
			} catch (error) {
				throw mapError(error);
			}
		},
	};
}
