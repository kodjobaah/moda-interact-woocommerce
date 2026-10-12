/** Browser-side verification of the minimal paginated Woo recovery read DTO. */
export const RECOVERY_PAGE_SIZES = [10, 20, 25, 50];
export const RECOVERY_STATUSES = [
	'DETECTED',
	'MESSAGE_SENT',
	'ENGAGED',
	'COMPLETED',
	'EXPIRED',
	'CANCELLED',
];
export const RECOVERY_FILTERS = ['all', 'ongoing', ...RECOVERY_STATUSES];

function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(value, fields) {
	return (
		record(value) &&
		Object.keys(value).length === fields.length &&
		fields.every((field) => Object.hasOwn(value, field))
	);
}

function optionalText(value, maxLength) {
	return (
		value === null ||
		(typeof value === 'string' && value.length <= maxLength)
	);
}

function timestamp(value) {
	return (
		typeof value === 'string' &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
		!Number.isNaN(Date.parse(value)) &&
		new Date(value).toISOString() === value
	);
}

function recoveryItem(value) {
	if (
		!exact(value, [
			'id',
			'status',
			'detectedAt',
			'lastActivityAt',
			'totalPrice',
			'currency',
			'customer',
		]) ||
		typeof value.id !== 'string' ||
		!/^[A-Za-z0-9_-]{1,191}$/.test(value.id) ||
		!RECOVERY_STATUSES.includes(value.status) ||
		!timestamp(value.detectedAt) ||
		!timestamp(value.lastActivityAt) ||
		!(
			value.totalPrice === null ||
			(typeof value.totalPrice === 'string' &&
				/^-?\d{1,40}(?:\.\d{1,30})?$/.test(value.totalPrice))
		) ||
		!(
			value.currency === null ||
			(typeof value.currency === 'string' &&
				/^[A-Z]{3}$/.test(value.currency))
		)
	) {
		return false;
	}
	return (
		value.customer === null ||
		(exact(value.customer, ['displayName', 'email']) &&
			optionalText(value.customer.displayName, 160) &&
			optionalText(value.customer.email, 320))
	);
}

/**
 * Reject unknown fields so provider identifiers, URLs or credentials cannot leak into the UI.
 * @param {unknown} value
 */
export function parseRecoveriesResponse(value) {
	if (
		!exact(value, [
			'schemaVersion',
			'timeZone',
			'from',
			'to',
			'q',
			'status',
			'page',
			'pageSize',
			'total',
			'totalPages',
			'hasPrevious',
			'hasNext',
			'items',
		]) ||
		value.schemaVersion !== 1 ||
		typeof value.timeZone !== 'string' ||
		!value.timeZone ||
		value.timeZone.length > 255 ||
		typeof value.from !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}$/.test(value.from) ||
		typeof value.to !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}$/.test(value.to) ||
		typeof value.q !== 'string' ||
		[...value.q].length > 100 ||
		!RECOVERY_FILTERS.includes(value.status) ||
		!Number.isSafeInteger(value.page) ||
		value.page < 1 ||
		value.page > 9999 ||
		!RECOVERY_PAGE_SIZES.includes(value.pageSize) ||
		!Number.isSafeInteger(value.total) ||
		value.total < 0 ||
		!Number.isSafeInteger(value.totalPages) ||
		value.totalPages !==
			Math.max(1, Math.ceil(value.total / value.pageSize)) ||
		value.page > value.totalPages ||
		value.hasPrevious !== value.page > 1 ||
		value.hasNext !== value.page < value.totalPages ||
		!Array.isArray(value.items) ||
		value.items.length > value.pageSize ||
		!value.items.every(recoveryItem)
	) {
		throw new Error('remote_response_invalid');
	}
	return value;
}
