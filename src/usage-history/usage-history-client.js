import apiFetch from '@wordpress/api-fetch';

export const USAGE_HISTORY_PATH = '/moda-interact/v1/merchant/usage-history';
const VIEWS = ['current', 'past'];
const KINDS = ['ALL', 'RECOVERY_CONVERSATION'];
const SIZES = [10, 25, 50, 100];
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const RECOVERY_ID = /^[A-Za-z0-9_-]{1,191}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;
const TIMESTAMP =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function object(value, keys) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function id(value, pattern = ID) {
	return typeof value === 'string' && pattern.test(value);
}

function iso(value) {
	return (
		typeof value === 'string' &&
		value.length <= 45 &&
		TIMESTAMP.test(value) &&
		Number.isFinite(Date.parse(value))
	);
}

function signed(value) {
	return Number.isSafeInteger(value);
}

function period(value) {
	return (
		object(value, ['id', 'periodStart', 'periodEnd']) &&
		id(value.id) &&
		iso(value.periodStart) &&
		iso(value.periodEnd) &&
		Date.parse(value.periodStart) < Date.parse(value.periodEnd)
	);
}

function event(value) {
	if (
		!object(value, [
			'id',
			'metric',
			'quantity',
			'occurredAt',
			'sourceRecovery',
		]) ||
		!id(value.id, RECOVERY_ID) ||
		typeof value.metric !== 'string' ||
		!/^[A-Z][A-Z0-9_]{0,63}$/.test(value.metric) ||
		!signed(value.quantity) ||
		!iso(value.occurredAt)
	) {
		return false;
	}
	const source = value.sourceRecovery;
	return (
		source === null ||
		(object(source, ['recoveryId', 'customerName']) &&
			id(source.recoveryId, RECOVERY_ID) &&
			(source.customerName === null ||
				(typeof source.customerName === 'string' &&
					new TextEncoder().encode(source.customerName).length <= 512 &&
					!/[\x00-\x1F\x7F]/.test(source.customerName))))
	);
}

/** Parse only the approved API-022 v1 projection; reject extra sensitive fields. */
export function parseUsageHistory(payload) {
	if (
		!object(payload, [
			'schemaVersion',
			'state',
			'usageView',
			'periodPage',
			'usageEvents',
			'usagePagination',
		]) ||
		payload.schemaVersion !== 1 ||
		!['ready', 'unavailable'].includes(payload.state) ||
		!VIEWS.includes(payload.usageView)
	) {
		throw new Error('invalid_response');
	}
	const periods = payload.periodPage;
	const paging = payload.usagePagination;
	if (
		!object(periods, ['items', 'previousCursor', 'nextCursor']) ||
		!Array.isArray(periods.items) ||
		periods.items.length > 25 ||
		!periods.items.every(period) ||
		![periods.previousCursor, periods.nextCursor].every(
			(value) => value === null || id(value, CURSOR)
		) ||
		!object(paging, [
			'page',
			'pageSize',
			'total',
			'totalQuantity',
			'billId',
			'periodStart',
			'periodEnd',
		]) ||
		!Number.isSafeInteger(paging.page) ||
		paging.page < 1 ||
		paging.page > 1000 ||
		!SIZES.includes(paging.pageSize) ||
		!Number.isSafeInteger(paging.total) ||
		paging.total < 0 ||
		!signed(paging.totalQuantity) ||
		!(paging.billId === null || id(paging.billId)) ||
		!(paging.periodStart === null || iso(paging.periodStart)) ||
		!(paging.periodEnd === null || iso(paging.periodEnd)) ||
		(paging.periodStart === null) !== (paging.periodEnd === null) ||
		!Array.isArray(payload.usageEvents) ||
		payload.usageEvents.length > paging.pageSize ||
		payload.usageEvents.length > paging.total ||
		!payload.usageEvents.every(event)
	) {
		throw new Error('invalid_response');
	}
	return payload;
}

function validFilters({ view, periodId, kind, page, pageSize, periodCursor }) {
	return (
		VIEWS.includes(view) &&
		KINDS.includes(kind) &&
		Number.isSafeInteger(page) &&
		page >= 1 &&
		page <= 1000 &&
		SIZES.includes(pageSize) &&
		(typeof periodId === 'string' &&
			(periodId === '' || id(periodId))) &&
		(typeof periodCursor === 'string' &&
			(periodCursor === '' || id(periodCursor, CURSOR)))
	);
}

function failureCode(error) {
	const values = [
		error?.data?.status,
		error?.data?.error,
		error?.status,
		error?.code,
		error?.message,
	];
	if (
		values.some((value) =>
			[
				'RECONNECT_REQUIRED',
				'SITE_URL_CHANGED',
				'LOCAL_STATE_INVALID',
				'unauthorized',
			].includes(value)
		) ||
		error?.status === 401 ||
		error?.data?.status === 401
	) {
		return 'reconnect_required';
	}
	if (
		values.some((value) =>
			['rest_forbidden', 'USAGE_HISTORY_DENIED', 'permission_denied'].includes(
				value
			)
		) ||
		error?.status === 403 ||
		error?.data?.status === 403
	) {
		return 'permission_denied';
	}
	if (values.some((value) => ['INVALID_CURSOR', 'invalid_cursor'].includes(value))) {
		return 'invalid_cursor';
	}
	if (values.some((value) => ['INVALID_PERIOD', 'invalid_period'].includes(value))) {
		return 'invalid_period';
	}
	return 'remote_unavailable';
}

/** Same-origin WordPress REST only; apiFetch supplies its WordPress nonce. */
export function createUsageHistoryClient(request = apiFetch) {
	return {
		available: true,
		async getHistory(filters, signal) {
			if (!validFilters(filters)) {
				throw new Error('invalid_request');
			}
			const { view, periodId, kind, page, pageSize, periodCursor } = filters;
			const params = new URLSearchParams({
				view,
				kind,
				page: String(page),
				pageSize: String(pageSize),
			});
			if (periodId) {
				params.set('periodId', periodId);
			}
			if (periodCursor) {
				params.set('periodCursor', periodCursor);
			}
			let data;
			try {
				data = await request({
					path: `${USAGE_HISTORY_PATH}?${params}`,
					method: 'GET',
					signal,
				});
			} catch (error) {
				if (signal?.aborted) {
					throw error;
				}
				throw new Error(failureCode(error));
			}
			const response = parseUsageHistory(data);
			if (
				response.usageView !== view ||
				response.usagePagination.page !== page ||
				response.usagePagination.pageSize !== pageSize
			) {
				throw new Error('invalid_response');
			}
			return response;
		},
	};
}
