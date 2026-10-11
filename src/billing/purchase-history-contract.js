/** Strict API-006 read contract; provider IDs or surprise fields must never reach the UI. */
export const HISTORY_FILTERS = [
	'ACTIVE',
	'WITHDRAWN',
	'COMPLETED',
	'REFUNDED',
	'ALL',
];
export const HISTORY_PAGE_SIZES = [5, 10, 20];
export const WOO_ORDERS_URL = 'https://woocommerce.com/my-account/orders/';
const PURCHASE_STATES = [
	'REQUESTED',
	'ACTIVE',
	'WITHDRAWN',
	'COMPLETED',
	'REFUNDED',
];
const REFUND_STATES = [
	'REQUESTED',
	'PROVIDER_ACTION_REQUIRED',
	'COMPLETED',
	'REJECTED',
	'CANCELLED',
	'NEEDS_ATTENTION',
];
const UNAVAILABLE_REASONS = [
	'REFUND_ALREADY_ATTEMPTED',
	'NO_AVAILABLE_CREDITS',
	'PROVIDER_EVIDENCE_UNAVAILABLE',
	'REFUND_IN_PROGRESS',
];

const isRecord = (value) =>
	value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) =>
	isRecord(value) &&
	Object.keys(value).length === keys.length &&
	keys.every((key) => Object.hasOwn(value, key));
const quantity = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value, length) =>
	typeof value === 'string' &&
	value.trim().length > 0 &&
	value.length <= length;
const date = (value) =>
	typeof value === 'string' &&
	/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) &&
	!Number.isNaN(Date.parse(value));
const nullableDate = (value) => value === null || date(value);
const MONEY_KEYS = ['amount', 'currency'];
const money = (value) =>
	exact(value, MONEY_KEYS) &&
	typeof value.amount === 'string' &&
	/^\d{1,16}(?:\.\d{1,6})?$/.test(value.amount) &&
	typeof value.currency === 'string' &&
	/^[A-Z]{3}$/.test(value.currency);

function refund(value) {
	return (
		exact(value, [
			'status',
			'reason',
			'finalCreditQuantity',
			'providerAmount',
			'createdAt',
			'completedAt',
		]) &&
		REFUND_STATES.includes(value.status) &&
		(value.reason === null ||
			(typeof value.reason === 'string' &&
				/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reason))) &&
		(value.finalCreditQuantity === null ||
			quantity(value.finalCreditQuantity)) &&
		(value.providerAmount === null || money(value.providerAmount)) &&
		date(value.createdAt) &&
		nullableDate(value.completedAt)
	);
}

function purchase(value) {
	return (
		exact(value, [
			'id',
			'status',
			'createdAt',
			'activatedAt',
			'bundleLabel',
			'planName',
			'creditsGranted',
			'currentAmount',
			'reservedAmount',
			'availableAmount',
			'heldForRefundAmount',
			'refundEligible',
			'refundUnavailableReason',
			'refundAttempted',
			'latestRefund',
			'completedRefund',
			'originalProviderPurchase',
		]) &&
		text(value.id, 128) &&
		PURCHASE_STATES.includes(value.status) &&
		date(value.createdAt) &&
		nullableDate(value.activatedAt) &&
		(value.bundleLabel === null ||
			(typeof value.bundleLabel === 'string' &&
				value.bundleLabel.length <= 120)) &&
		text(value.planName, 255) &&
		[
			'creditsGranted',
			'currentAmount',
			'reservedAmount',
			'availableAmount',
			'heldForRefundAmount',
		].every((key) => quantity(value[key])) &&
		typeof value.refundEligible === 'boolean' &&
		typeof value.refundAttempted === 'boolean' &&
		(value.refundUnavailableReason === null ||
			UNAVAILABLE_REASONS.includes(value.refundUnavailableReason)) &&
		value.refundEligible === (value.refundUnavailableReason === null) &&
		(value.latestRefund === null || refund(value.latestRefund)) &&
		(value.completedRefund === null || refund(value.completedRefund)) &&
		(value.originalProviderPurchase === null ||
			money(value.originalProviderPurchase))
	);
}

export function parsePurchaseHistory(value) {
	const valid =
		exact(value, [
			'schemaVersion',
			'filter',
			'page',
			'pageSize',
			'total',
			'totalPages',
			'purchases',
			'refundRequest',
		]) &&
		value.schemaVersion === 1 &&
		HISTORY_FILTERS.includes(value.filter) &&
		HISTORY_PAGE_SIZES.includes(value.pageSize) &&
		quantity(value.total) &&
		quantity(value.totalPages) &&
		value.totalPages >= 1 &&
		quantity(value.page) &&
		value.page >= 1 &&
		value.page <= value.totalPages &&
		Array.isArray(value.purchases) &&
		value.purchases.length <= value.pageSize &&
		value.purchases.every(purchase) &&
		exact(value.refundRequest, ['method', 'url']) &&
		value.refundRequest.method === 'WOOCOMMERCE_ORDERS' &&
		value.refundRequest.url === WOO_ORDERS_URL;
	if (!valid) {
		throw new Error('remote_response_invalid');
	}
	return value;
}

export function canNavigateToWooRefund(purchaseRow, history) {
	return Boolean(
		purchaseRow?.refundEligible === true &&
		purchaseRow.refundAttempted === false &&
		purchaseRow.status === 'ACTIVE' &&
		history?.refundRequest?.method === 'WOOCOMMERCE_ORDERS' &&
		history.refundRequest.url === WOO_ORDERS_URL
	);
}
