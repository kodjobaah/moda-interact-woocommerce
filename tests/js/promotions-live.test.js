import { describe, expect, it, vi } from 'vitest';
import {
	parsePromotionSelection,
	parsePromotionsResponse,
} from '../../src/promotions/promotions-contract';
import {
	createPromotionsClient,
	PROMOTIONS_PATH,
} from '../../src/promotions/promotions-client';
import { PromotionsController } from '../../src/promotions/promotions-controller';

const revision = 'a'.repeat(64);
const offer = (change = {}) => ({
	id: 'campaign_1', merchantTitle: 'Autumn credits',
	merchantDescription: 'Five free recovery conversations',
	quantity: 5, expiresAt: '2026-11-30T00:00:00.000Z',
	remainingQuantity: 5, exhausted: false, previouslyClaimed: false,
	currentlySelected: false, eligible: true, selectable: true,
	...change,
});
const selection = (change = {}) => ({
	campaignId: 'campaign_1', merchantTitle: 'Autumn credits',
	remainingQuantity: 5, quantityGranted: 5, reservedQuantity: 0,
	committedQuantity: 0, expiresAt: '2026-11-30T00:00:00.000Z',
	locked: true, exhausted: false, campaignStatus: 'ACTIVE',
	targetEligible: true, spendable: true, ...change,
});
const pagination = (page = 1, totalEntries = 1) => ({
	page, pageSize: 6, totalEntries,
	totalPages: Math.max(1, Math.ceil(totalEntries / 6)),
});
const entry = (status = 'SELECTED') => ({
	campaignId: 'campaign_1', campaignTitle: 'Autumn credits', status,
	quantityGranted: 5, committedQuantity: 0, remainingQuantity: 5,
	lastSelectedAt: '2026-10-20T10:00:00.000Z',
	expiresAt: '2026-11-30T00:00:00.000Z',
});
const readResponse = (change = {}) => ({
	schemaVersion: 1, revision, offers: [offer()],
	offersPagination: pagination(), selection: null,
	history: { ...pagination(1, 0), entries: [] },
	...change,
});
const selectedResponse = () => ({
	schemaVersion: 1, revision: 'b'.repeat(64), selection: selection(),
});
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
};
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

const makeController = (read, select = vi.fn()) =>
	new PromotionsController({ read, select });

describe('API-021 promotions browser contract', () => {
	it('accepts exactly six rows/page and all seven authoritative history states', () => {
		const statuses = ['SELECTED', 'USED', 'EXHAUSTED', 'EXPIRED',
			'CLOSED', 'NO_LONGER_ELIGIBLE', 'REOPENED'];
		const six = Array.from({ length: 6 }, (_, index) =>
			offer({ id: `campaign_${index}` })
		);
		expect(parsePromotionsResponse(readResponse({
			offers: six, offersPagination: pagination(1, 6),
		})).offers).toHaveLength(6);
		for (const status of statuses) {
			const data = readResponse({ history: {
				...pagination(), entries: [entry(status)],
			} });
			expect(parsePromotionsResponse(data)).toBe(data);
		}
		expect(parsePromotionSelection(selectedResponse(), 'campaign_1'))
			.toEqual(selectedResponse());
	});

	it('rejects unexpected shop/secret properties, invalid grant maths, fake statuses, pages, and wrong CAS campaign', () => {
		const cases = [
			readResponse({ shopId: 'shop_other' }),
			readResponse({ offers: [offer({ selectable: 'true' })] }),
			readResponse({ offers: [offer(), offer()] }),
			readResponse({ offers: Array.from({ length: 7 }, (_, i) =>
				offer({ id: `campaign_${i}` })) }),
			readResponse({ revision: 'forged' }),
			readResponse({ history: { ...pagination(), entries: [entry('ACTIVE')] } }),
			readResponse({ offersPagination: { ...pagination(), pageSize: 10 } }),
			readResponse({ selection: selection({ remainingQuantity: 6 }) }),
		];
		for (const data of cases) expect(() => parsePromotionsResponse(data)).toThrow('REMOTE_RESPONSE_INVALID');
		expect(() => parsePromotionSelection(selectedResponse(), 'campaign_other'))
			.toThrow('REMOTE_RESPONSE_INVALID');
	});

	it('uses only same-origin WP REST with fixed request fields and no hosted credential', async () => {
		const fetch = vi.fn(async ({ method }) => method === 'GET' ? readResponse() : selectedResponse());
		const client = createPromotionsClient(fetch);
		await client.read({ offerPage: 1, historyPage: 1 });
		await client.select('campaign_1', revision);
		const get = fetch.mock.calls[0][0];
		const put = fetch.mock.calls[1][0];
		expect(get.method).toBe('GET');
		expect(get.path).toBe(`${PROMOTIONS_PATH}?offerPage=1&historyPage=1`);
		expect(put).toMatchObject({ method: 'PUT',
			path: `${PROMOTIONS_PATH}/selection`,
			data: { campaignId: 'campaign_1', expectedRevision: revision } });
		expect(Object.keys(put.data)).toHaveLength(2);
		expect(JSON.stringify(fetch.mock.calls)).not.toMatch(/Bearer|credential|shopId/);
		await expect(client.read({ offerPage: 1001, historyPage: 1 })).rejects.toThrow('INVALID_REQUEST');
		await expect(client.select('campaign_other', 'wrong')).rejects.toThrow('INVALID_REQUEST');
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('rejects a GET whose page exceeds requested page, even when otherwise well-formed', async () => {
		const fetch = vi.fn(async () => readResponse({
			offersPagination: { ...pagination(2, 8) },
		}));
		await expect(createPromotionsClient(fetch).read({ offerPage: 1, historyPage: 1 }))
			.rejects.toMatchObject({ code: 'REMOTE_RESPONSE_INVALID' });
	});

	it.each([
		[{ data: { status: 'RECONNECT_REQUIRED' } }, 'RECONNECT_REQUIRED'],
		[{ data: { status: 'DENIED' } }, 'DENIED'],
		[{ data: { status: 'PROMOTION_STALE' } }, 'PROMOTION_STALE'],
		[{ status: 503 }, 'REMOTE_UNAVAILABLE'],
	])('sanitises WordPress error state', async (failure, code) => {
		const client = createPromotionsClient(async () => { throw failure; });
		await expect(client.read({})).rejects.toMatchObject({ code });
	});
});

describe('live Woo promotions state', () => {
	it('loads and pages offers and history independently with bounded GET state', async () => {
		const calls = [];
		const c = makeController(vi.fn(async (query) => {
			calls.push(query);
			return readResponse({
				offersPagination: pagination(query.offerPage, 18),
				history: { ...pagination(query.historyPage, 12), entries: [entry()] },
			});
		}));
		c.setActive(true);
		await settle();
		expect(c.state.status).toBe('READY');
		expect(c.goToOffersPage(2)).toBeTruthy();
		await settle();
		expect(c.state.offersPagination.page).toBe(2);
		expect(c.goToHistoryPage(2)).toBeTruthy();
		await settle();
		expect(c.state.history.page).toBe(2);
		expect(calls).toEqual([
			{ offerPage: 1, historyPage: 1 },
			{ offerPage: 2, historyPage: 1 },
			{ offerPage: 2, historyPage: 2 },
		]);
		expect(c.goToOffersPage(1001)).toBe(false);
		expect(c.goToHistoryPage(3)).toBe(false);
		c.dispose();
	});

	it('prevents double-click, uses GET revision only, and refreshes selected grant and history after PUT', async () => {
		const pending = deferred();
		let confirmed = false;
		const read = vi.fn(async () => confirmed
			? readResponse({ selection: selection(),
				offers: [offer({ currentlySelected: true, previouslyClaimed: true, selectable: false })],
				history: { ...pagination(), entries: [entry()] },
			}) : readResponse());
		const select = vi.fn(() => pending.promise);
		const c = makeController(read, select);
		c.setActive(true);
		await settle();
		const first = c.select('campaign_1');
		const second = c.select('campaign_1');
		expect(await second).toBe(false);
		expect(c.state.saving).toBe(true);
		expect(select).toHaveBeenCalledTimes(1);
		expect(select.mock.calls[0]).toEqual(['campaign_1', revision, expect.any(AbortSignal)]);
		confirmed = true;
		pending.resolve(selectedResponse());
		await first;
		expect(read).toHaveBeenCalledTimes(2);
		expect(c.state.selection).toEqual(selection());
		expect(c.state.history.entries).toHaveLength(1);
		expect(await c.select('campaign_1')).toBe(false);
		c.dispose();
	});

	it('blocks locked, unselectable, exhausted and previously claimed offers', async () => {
		for (const offered of [
			offer({ eligible: false }),
			offer({ selectable: false }),
			offer({ exhausted: true }),
			offer({ previouslyClaimed: true }),
		]) {
			const select = vi.fn();
			const c = makeController(async () => readResponse({ offers: [offered] }), select);
			c.setActive(true); await settle();
			expect(await c.select('campaign_1')).toBe(false);
			expect(select).not.toHaveBeenCalled();
			c.dispose();
		}
	});

	it('handles stale 409 and 422 with an authoritative reload and no optimistic grant', async () => {
		for (const [code, expected] of [['PROMOTION_STALE', 'CONFLICT'], ['PROMOTION_INELIGIBLE', 'PROMOTION_INELIGIBLE']]) {
			const read = vi.fn(async () => readResponse());
			const c = makeController(read, async () => { throw Object.assign(new Error(code), { code }); });
			c.setActive(true); await settle();
			await c.select('campaign_1');
			expect(read).toHaveBeenCalledTimes(2);
			expect(c.state.error).toBe(expected);
			expect(c.state.selection).toBeNull();
			c.dispose();
		}
	});

	it('does not expose a cached promotion after reconnect, permission or service failure', async () => {
		for (const [code, status] of [
			['RECONNECT_REQUIRED', 'RECONNECT_REQUIRED'],
			['DENIED', 'DENIED'],
			['REMOTE_UNAVAILABLE', 'UNAVAILABLE'],
		]) {
			let calls = 0;
			const c = makeController(async () => {
				if (calls++ === 0) return readResponse();
				throw Object.assign(new Error(code), { code });
			});
			c.setActive(true); await settle();
			expect(c.state.offers).toHaveLength(1);
			await c.refresh();
			expect(c.state.status).toBe(status);
			expect(c.state.offers).toHaveLength(0);
			expect(c.state.selection).toBeNull();
			c.dispose();
		}
	});

	it('fences stale GET on refresh, deactivation and component unmount', async () => {
		const first = deferred();
		const second = deferred();
		const reads = vi.fn().mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise)
			.mockImplementation(() => Promise.resolve(readResponse()));
		const c = makeController(reads);
		c.setActive(true);
		const pending = c.refresh();
		first.resolve(readResponse({ revision: 'c'.repeat(64) }));
		await settle();
		expect(c.state.status).toBe('LOADING');
		second.resolve(readResponse());
		await pending;
		expect(c.state.revision).toBe(revision);
		c.setActive(false);
		expect(c.state.status).toBe('IDLE');
		expect(c.state.offers).toHaveLength(0);
		c.setActive(true);
		c.dispose();
		await settle();
		expect(c.state.status).toBe('LOADING');
	});

	it('fences an in-flight PUT when the installation becomes inactive', async () => {
		const pending = deferred();
		const select = vi.fn(() => pending.promise);
		const c = makeController(async () => readResponse(), select);
		c.setActive(true); await settle();
		const saving = c.select('campaign_1');
		c.setActive(false);
		pending.resolve(selectedResponse());
		expect(await saving).toBe(false);
		expect(c.state.status).toBe('IDLE');
		expect(c.state.offers).toHaveLength(0);
		c.dispose();
	});
});
