import {
	RECOVERY_FILTERS,
	RECOVERY_PAGE_SIZES,
} from '../api/recoveries-contract';

const RECOVERY_ID = /^[A-Za-z0-9_-]{1,191}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ADMIN_PAGE = 'moda-interact-recoveries';

function validDate(value) {
	if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
		return false;
	}
	const parsed = new Date(`${value}T12:00:00Z`);
	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}

function validRange(from, to) {
	return (
		validDate(from) &&
		validDate(to) &&
		from <= to &&
		(Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
			86400000 <=
			365
	);
}

function validPage(value) {
	const page = Number(value);
	return (
		/^\d{1,4}$/.test(String(value)) &&
		Number.isSafeInteger(page) &&
		page >= 1 &&
		page <= 9999
	);
}

/**
 * Parse only approved list filters, never provider credentials or arbitrary URL fields.
 * @param {string} search
 */
export function readRecoveryListQuery(search = '') {
	const params = new URLSearchParams(search);
	const query = { page: 1, pageSize: 25 };
	if (validPage(params.get('recoveryPage'))) {
		query.page = Number(params.get('recoveryPage'));
	}
	const size = Number(params.get('pageSize'));
	if (RECOVERY_PAGE_SIZES.includes(size)) {
		query.pageSize = size;
	}
	const from = params.get('from');
	const to = params.get('to');
	if (validRange(from, to)) {
		query.from = from;
		query.to = to;
	}
	const q = params.get('q');
	if (q !== null && [...q].length <= 100) {
		query.q = q;
	}
	const status = params.get('status');
	if (RECOVERY_FILTERS.includes(status)) {
		query.status = status;
	}
	return query;
}

/**
 * Build a WordPress-admin URL that cannot introduce an extra WP sidebar page.
 * @param {Object} query
 */
export function recoveriesListHref(query = {}) {
	const params = new URLSearchParams({ page: ADMIN_PAGE });
	if (validRange(query.from, query.to)) {
		params.set('from', query.from);
		params.set('to', query.to);
	}
	if (typeof query.q === 'string' && [...query.q].length <= 100 && query.q) {
		params.set('q', query.q);
	}
	if (RECOVERY_FILTERS.includes(query.status)) {
		params.set('status', query.status);
	}
	if (validPage(query.page)) {
		params.set('recoveryPage', String(query.page));
	}
	if (RECOVERY_PAGE_SIZES.includes(query.pageSize)) {
		params.set('pageSize', String(query.pageSize));
	}
	return `admin.php?${params}`;
}

/**
 * Link only to a validated shop-scoped recovery ID supplied by the list API.
 * @param {string} recoveryId
 * @param {Object} query
 */
export function recoveryDetailHref(recoveryId, query) {
	if (typeof recoveryId !== 'string' || !RECOVERY_ID.test(recoveryId)) {
		return null;
	}
	return `${recoveriesListHref(query)}&recoveryId=${encodeURIComponent(recoveryId)}`;
}

/**
 * Null means list; invalid recovery IDs get a safe unavailable detail shell.
 * @param {string} search
 */
export function readRecoveryDetailRoute(search = '') {
	const params = new URLSearchParams(search);
	if (!params.has('recoveryId')) {
		return null;
	}
	const candidate = params.get('recoveryId');
	return {
		recoveryId:
			typeof candidate === 'string' && RECOVERY_ID.test(candidate)
				? candidate
				: null,
		listHref: recoveriesListHref(readRecoveryListQuery(search)),
	};
}
