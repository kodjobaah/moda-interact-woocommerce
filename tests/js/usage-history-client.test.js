import { describe, expect, it, vi } from 'vitest';
import {
	createUsageHistoryClient,
	parseUsageHistory,
	USAGE_HISTORY_PATH,
} from '../../src/usage-history/usage-history-client';

const filters = () => ({
	view: 'current',
	periodId: '',
	kind: 'ALL',
	page: 1,
	pageSize: 10,
	periodCursor: '',
});
const sample = (overrides = {}) => ({
	schemaVersion: 1,
	state: 'ready',
	usageView: 'current',
	periodPage: {
		items: [{ id: 'period_1', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-10-31T00:00:00Z' }],
		previousCursor: null,
		nextCursor: 'cursor_2',
	},
	usageEvents: [
		{ id: 'usage_1', metric: 'RECOVERY_CONVERSATION', quantity: -2,
			occurredAt: '2026-10-14T12:00:00Z', sourceRecovery: { recoveryId: 'recovery_1', customerName: 'Name <script>alert(1)</script>' } },
	],
	usagePagination: { page: 1, pageSize: 10, total: 1, totalQuantity: -2,
		billId: 'period_1', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-10-31T00:00:00Z' },
	...overrides,
});

const sampleV2 = (chargedAgainst = 'PURCHASED_TOP_UP') => {
	const v1 = sample();
	return {
		...v1,
		schemaVersion: 2,
		usageEvents: v1.usageEvents.map((event) => ({ ...event, chargedAgainst })),
	};
};

describe('Woo API-022 usage-history client', () => {
	it('accepts strict v2 allocation evidence while retaining the exact legacy v1 projection', async () => {
		for (const chargedAgainst of [
			'LIFETIME_FREE_CREDITS', 'INCLUDED_PLAN_ALLOWANCE', 'PURCHASED_TOP_UP',
			'PROMOTIONAL_CREDITS', 'NOT_APPLICABLE', 'UNATTRIBUTED',
		]) {
			const v2 = sampleV2(chargedAgainst);
			expect(parseUsageHistory(v2).usageEvents[0].chargedAgainst).toBe(chargedAgainst);
			expect(await createUsageHistoryClient(vi.fn(async () => v2)).getHistory(filters())).toEqual(v2);
		}
		expect(parseUsageHistory(sample()).schemaVersion).toBe(1);
	});

	it.each([
		{ ...sampleV2(), usageEvents: sampleV2().usageEvents.map(({ chargedAgainst, ...event }) => event) },
		{ ...sampleV2(), usageEvents: [{ ...sampleV2().usageEvents[0], chargedAgainst: 'STRANGE' }] },
		{ ...sampleV2(), usageEvents: [{ ...sampleV2().usageEvents[0], chargedAgainst: null }] },
		{ ...sampleV2(), usageEvents: [{ ...sampleV2().usageEvents[0], purchasedCreditPurchaseId: 'secret' }] },
		{ ...sampleV2(), schemaVersion: 3 },
		{ ...sampleV2(), usageEvents: [{ ...sampleV2().usageEvents[0], metric: 'UNRECOGNISED_METRIC' }] },
		{ ...sample(), usageEvents: [{ ...sample().usageEvents[0], chargedAgainst: 'LIFETIME_FREE_CREDITS' }] },
	])('rejects invalid v1/v2 response fields without guessing', (payload) => {
		expect(() => parseUsageHistory(payload)).toThrow('invalid_response');
	});
	it('calls only the same-origin WP path with bounded filters and abort signal', async () => {
		const request = vi.fn(async () => sample());
		const client = createUsageHistoryClient(request);
		const controller = new AbortController();
		expect(client.available).toBe(true);
		expect(await client.getHistory(filters(), controller.signal)).toEqual(sample());
		expect(request).toHaveBeenCalledOnce();
		const options = request.mock.calls[0][0];
		expect(options.method).toBe('GET');
		expect(options.signal).toBe(controller.signal);
		const [path, query] = options.path.split('?');
		expect(path).toBe(USAGE_HISTORY_PATH);
		expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
			view: 'current', kind: 'ALL', page: '1', pageSize: '10',
		});
		expect(options).not.toHaveProperty('headers');
	});

	it('preserves period and cursor, negative corrections and previous cursor', async () => {
		const request = vi.fn(async () => sample({
			usageView: 'past',
			periodPage: { ...sample().periodPage, previousCursor: 'cursor_1' },
		}));
		await createUsageHistoryClient(request).getHistory({
			...filters(), view: 'past', periodId: 'period_1', periodCursor: 'cursor_2',
		});
		const parsed = new URLSearchParams(request.mock.calls[0][0].path.split('?')[1]);
		expect(parsed.get('periodId')).toBe('period_1');
		expect(parsed.get('periodCursor')).toBe('cursor_2');
		expect(parsed.has('shopId')).toBe(false);
		expect(parsed.has('_locale')).toBe(false); // wp apiFetch owns WordPress locale/nonce
	});

	it('accepts genuine Free lifetime events and valid empty usage without synthetic billing periods', () => {
		const free = sample({
			periodPage: { items: [], previousCursor: null, nextCursor: null },
			usagePagination: { ...sample().usagePagination, billId: null, periodStart: null, periodEnd: null },
		});
		expect(parseUsageHistory(free).usagePagination.totalQuantity).toBe(-2);
		expect(parseUsageHistory({
			...free, usageEvents: [], usagePagination: { ...free.usagePagination, total: 0, totalQuantity: 0 },
		}).usageEvents).toEqual([]);
	});

	it.each([
		{ shopId: 'foreign' },
		{ usageEvents: [{ ...sample().usageEvents[0], rawProviderKey: 'secret' }] },
		{ usageEvents: [{ ...sample().usageEvents[0], sourceRecovery: { recoveryId: '../foreign', customerName: 'Wrong Shop' } }] },
		{ usagePagination: { ...sample().usagePagination, totalQuantity: null } },
		{ usagePagination: { ...sample().usagePagination, pageSize: 1000 } },
		{ usageEvents: new Array(101).fill(sample().usageEvents[0]) },
		{ periodPage: { ...sample().periodPage, nextCursor: 'bad/token' } },
		{ state: 'invented' },
	])('rejects malformed or sensitive hosted data', (change) => {
		expect(() => parseUsageHistory({ ...sample(), ...change })).toThrow('invalid_response');
	});

	it('rejects unsupported filters before any network request', async () => {
		const request = vi.fn(async () => sample());
		const client = createUsageHistoryClient(request);
		for (const changes of [
			{ view: 'all' }, { kind: 'PURCHASE' }, { page: 0 }, { page: 1001 },
			{ pageSize: 5 }, { periodId: '../x' }, { periodCursor: 'bad/cursor' },
		]) {
			await expect(client.getHistory({ ...filters(), ...changes })).rejects.toThrow('invalid_request');
		}
		expect(request).not.toHaveBeenCalled();
	});

	it.each([
		[{ data: { status: 'RECONNECT_REQUIRED' } }, 'reconnect_required'],
		[{ data: { status: 'SITE_URL_CHANGED' } }, 'reconnect_required'],
		[{ status: 401 }, 'reconnect_required'],
		[{ code: 'rest_forbidden', status: 403 }, 'permission_denied'],
		[{ data: { status: 'INVALID_CURSOR' }, status: 409 }, 'invalid_cursor'],
		[{ data: { status: 'INVALID_PERIOD' }, status: 409 }, 'invalid_period'],
		[{ status: 503, message: 'secret-not-for-display' }, 'remote_unavailable'],
	])('maps WP failure without leaking provider error bodies', async (error, expected) => {
		const client = createUsageHistoryClient(vi.fn(async () => { throw error; }));
		await expect(client.getHistory(filters())).rejects.toThrow(expected);
	});

	it('rejects mismatched response selection and does not convert it to empty records', async () => {
		const client = createUsageHistoryClient(vi.fn(async () => sample({ usageView: 'past' })));
		await expect(client.getHistory(filters())).rejects.toThrow('invalid_response');
	});
});
