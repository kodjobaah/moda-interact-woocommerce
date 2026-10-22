import { describe, expect, it, vi } from 'vitest';
import { UsageHistoryController } from '../../src/usage-history/usage-history-controller';

const page = (overrides = {}) => ({
	state: 'ready',
	usageView: 'current',
	periodPage: {
		items: [
			{
				id: 'period_a',
				periodStart: '2026-10-01T00:00:00Z',
				periodEnd: '2026-11-01T00:00:00Z',
			},
		],
		nextCursor: 'nextperiod',
		previousCursor: null,
	},
	usagePagination: {
		billId: 'period_a',
		page: 1,
		pageSize: 10,
		total: 12,
		totalQuantity: 12,
		periodStart: '2026-10-01T00:00:00Z',
		periodEnd: '2026-11-01T00:00:00Z',
	},
	usageEvents: [
		{
			id: 'evt_1',
			metric: 'RECOVERY_CONVERSATION',
			quantity: 1,
			occurredAt: '2026-10-10T00:00:00Z',
			sourceRecovery: null,
		},
	],
	...overrides,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Woo usage history controller', () => {
	it('honours a deliberately disabled injected client without requests', async () => {
		const read = vi.fn();
		const c = new UsageHistoryController({
			available: false,
			getHistory: read,
		});
		const states = [];
		c.subscribe((value) => states.push(value.status));
		c.setActive(true);
		expect(c.state.status).toBe('UNAVAILABLE');
		c.setView('past');
		expect(c.state.view).toBe('past');
		expect(c.state.status).toBe('UNAVAILABLE');
		expect(read).not.toHaveBeenCalled();
		c.dispose();
	});

	it('preserves selections and applies period, metric, page-size and page filters', async () => {
		const read = vi.fn(async () => page());
		const c = new UsageHistoryController({
			available: true,
			getHistory: read,
		});
		c.setActive(true);
		await settle();
		expect(c.state.status).toBe('READY');
		c.setPeriod('period_a');
		await settle();
		c.setKind('RECOVERY_CONVERSATION');
		await settle();
		c.setPageSize(25);
		await settle();
		c.setPage(3); // more than 12 rows, so rejected
		expect(c.state.page).toBe(1);
		c.setPageSize(10);
		await settle();
		c.setPage(2);
		await settle();
		expect(read).toHaveBeenLastCalledWith(
			expect.objectContaining({
				periodId: 'period_a',
				kind: 'RECOVERY_CONVERSATION',
				pageSize: 10,
				page: 2,
			}),
			expect.any(AbortSignal)
		);
		const calls = read.mock.calls.length;
		c.setPage(2);
		c.setKind('RECOVERY_CONVERSATION');
		c.refresh();
		await settle();
		expect(read).toHaveBeenCalledTimes(calls + 1);
		c.dispose();
	});

	it('keeps period cursor separate from event pagination and validates selectors', async () => {
		const read = vi.fn(async () => page());
		const c = new UsageHistoryController({
			available: true,
			getHistory: read,
		});
		c.setActive(true);
		await settle();
		c.setPeriodCursor('unexpected');
		c.setPeriod('bad/period');
		c.setKind('PURCHASE');
		c.setPageSize(7);
		expect(read).toHaveBeenCalledTimes(1);
		c.setPeriod('period_a');
		await settle();
		c.setPeriodCursor('nextperiod');
		await settle();
		expect(read.mock.lastCall[0]).toMatchObject({ periodCursor: 'nextperiod', periodId: '', page: 1 });
		c.setView('past');
		await settle();
		expect(c.state).toMatchObject({
			view: 'past',
			page: 1,
			periodCursor: '',
			periodId: '',
		});
		c.dispose();
	});

	it('drops stale responses after selection changes, deactivation, and dispose', async () => {
		const jobs = [];
		const c = new UsageHistoryController({
			available: true,
			getHistory: vi.fn(
				() => new Promise((resolve) => jobs.push(resolve))
			),
		});
		c.setActive(true);
		c.setView('past');
		jobs[0](page());
		await settle();
		expect(c.state.status).toBe('LOADING');
		jobs[1](page());
		await settle();
		expect(c.state.status).toBe('READY');
		c.setActive(false);
		expect(c.state.status).toBe('IDLE');
		c.setActive(true);
		c.dispose();
		jobs[2](page());
		await settle();
		expect(c.state.status).toBe('LOADING');
	});

	it.each([
		['invalid_cursor', 'INVALID_CURSOR'],
		['invalid_period', 'INVALID_PERIOD'],
		['reconnect_required', 'RECONNECT'],
		['permission_denied', 'DENIED'],
		['remote_unavailable', 'FAILED'],
	])(
		'maps %s into %s without manufacturing empty usage',
		async (error, expected) => {
			const c = new UsageHistoryController({
				available: true,
				getHistory: async () => {
					throw new Error(error);
				},
			});
			c.setActive(true);
			await settle();
			expect(c.state.status).toBe(expected);
			expect(c.state.data).toBeNull();
			c.dispose();
		}
	);

	it('does not issue duplicate requests while loading or restore stale data on disconnect', async () => {
		const resolvers = [];
		const read = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
		const c = new UsageHistoryController({ available: true, getHistory: read });
		c.setActive(true);
		c.refresh();
		c.refresh();
		expect(read).toHaveBeenCalledTimes(1);
		c.setView('past');
		expect(read).toHaveBeenCalledTimes(2);
		resolvers[0](page());
		await settle();
		expect(c.state.status).toBe('LOADING');
		c.setActive(false);
		resolvers[1](page());
		await settle();
		expect(c.state.status).toBe('IDLE');
		c.dispose();
	});

	it('does not treat an unavailable paid period as a real empty history', async () => {
		const c = new UsageHistoryController({ available: true, getHistory: async () => page({ state: 'unavailable', usageEvents: [] }) });
		c.setActive(true);
		await settle();
		expect(c.state.status).toBe('UNAVAILABLE');
		expect(c.state.data.state).toBe('unavailable');
		c.dispose();
	});
});
