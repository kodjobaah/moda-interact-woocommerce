import { describe, expect, it, vi } from 'vitest';
import { UsageHistoryView } from '../../src/usage-history/usage-history-screen';
import { UsageHistoryToolbar } from '../../src/usage-history/usage-history-toolbar';
import {
	UsageHistoryResults,
	usageChargeLabel,
} from '../../src/usage-history/usage-history-results';
import { usageFormatters } from '../../src/usage-history/usage-history-format';
import {
	initialMerchantSurface,
	isNativeMerchantPage,
} from '../../src/native-admin/page-surface';

function walk(node, result = []) {
	if (Array.isArray(node)) {
		node.forEach((child) => walk(child, result));
		return result;
	}
	if (!node || typeof node !== 'object' || !node.props) {
		return result;
	}
	result.push(node);
	walk(node.props.children, result);
	return result;
}
const history = (status, data = null) => ({
	state: {
		status,
		view: 'current',
		periodId: '',
		kind: 'ALL',
		periodCursor: '',
		pageSize: 10,
		page: 1,
		data,
	},
	refresh: vi.fn(),
	setView: vi.fn(),
	setPeriod: vi.fn(),
	setKind: vi.fn(),
	setPageSize: vi.fn(),
	setPage: vi.fn(),
	setPeriodCursor: vi.fn(),
	clearCursor: vi.fn(),
});
const data = {
	periodPage: {
		items: [
			{
				id: 'bill_one',
				periodStart: '2026-10-01T00:00:00Z',
				periodEnd: '2026-11-01T00:00:00Z',
			},
		],
		nextCursor: 'valid',
		previousCursor: null,
	},
	usagePagination: {
		billId: 'bill_one',
		total: 24,
		totalQuantity: 24,
		page: 1,
		pageSize: 10,
		periodStart: '2026-10-01T00:00:00Z',
		periodEnd: '2026-11-01T00:00:00Z',
	},
	usageEvents: [
		{
			id: 'event_1',
			metric: 'RECOVERY_CONVERSATION',
			quantity: 1,
			occurredAt: '2026-10-14T12:00:00Z',
			sourceRecovery: {
				recoveryId: 'recovery_01',
				customerName: 'Test User',
			},
		},
	],
};

describe('usage history presentation', () => {
	it.each([
		'IDLE',
		'LOADING',
		'UNAVAILABLE',
		'RECONNECT',
		'DENIED',
		'FAILED',
		'INVALID_CURSOR',
		'INVALID_PERIOD',
	])('renders a truthful %s state', (status) => {
		const ui = UsageHistoryView({ history: history(status) });
		const elements = walk(ui);
		expect(elements.some((node) => node.type === UsageHistoryToolbar)).toBe(
			true
		);
		expect(elements.some((node) => node.type === UsageHistoryResults)).toBe(
			true
		);
		expect(
			elements.some(
				(node) =>
					node.type === 'div' &&
					['status', 'alert'].includes(node.props.role)
			)
		).toBe(true);
	});

	it('provides the connection page when credentials must be re-established', () => {
		const ui = UsageHistoryView({ history: history('RECONNECT') });
		const links = walk(ui).filter((node) => node.type === 'a');
		expect(links.some((node) => node.props.href === 'admin.php?page=moda-interact')).toBe(true);
	});

	it('renders a signed Free lifetime usage total even without BillingPeriod', () => {
		const free = {
			...data,
			usagePagination: { ...data.usagePagination, billId: null, periodStart: null, periodEnd: null, totalQuantity: -2 },
		};
		const rendered = UsageHistoryResults({ history: history('READY', free), locale: 'en-GB' });
		const nodes = walk(rendered);
		expect(nodes.some((node) => node.type === 'p' && [].concat(node.props.children).includes('-2'))).toBe(true);
	});

	it('announces an empty usage period without presenting it as unavailable', () => {
		const emptyData = { ...data, usageEvents: [] };
		const result = UsageHistoryResults({
			history: history('READY', emptyData),
			locale: 'en-GB',
		});
		const elements = walk(result);
		expect(
			elements.some(
				(node) => node.type === 'p' && node.props.role === 'status'
			)
		).toBe(true);
	});

	it('current usage has no period picker or period cursor pager', () => {
		const h = history('READY', data);
		const controls = UsageHistoryToolbar({ history: h, locale: 'de-DE' });
		const nodes = walk(controls);
		const selects = nodes.filter((node) => node.type === 'select');
		expect(selects).toHaveLength(2); // Event type and rows per page only.
		expect(nodes.some((node) => node.props.className === 'moda-usage__period-paging')).toBe(false);
		selects[0].props.onChange({ target: { value: 'RECOVERY_CONVERSATION' } });
		selects[1].props.onChange({ target: { value: '25' } });
		expect(h.setKind).toHaveBeenCalledWith('RECOVERY_CONVERSATION');
		expect(h.setPageSize).toHaveBeenCalledWith(25);
		expect(h.setPeriod).not.toHaveBeenCalled();
		const results = walk(UsageHistoryResults({ history: h, locale: 'en-GB' }));
		expect(results.some((node) => node.type === 'h2' && String(node.props.children).includes('Oct'))).toBe(true);
	});

	it('past paid usage auto-selects its effective period and retains period and event pagination', () => {
		const h = history('READY', data);
		h.state.view = 'past';
		const controls = UsageHistoryToolbar({ history: h, locale: 'de-DE' });
		const nodes = walk(controls);
		const selects = nodes.filter((node) => node.type === 'select');
		expect(selects).toHaveLength(3);
		expect(selects[0].props.value).toBe('bill_one'); // API auto-selection.
		selects[0].props.onChange({ target: { value: 'bill_one' } });
		expect(h.setPeriod).toHaveBeenCalledWith('bill_one');
		expect(nodes.some((node) => node.props.className === 'moda-usage__period-paging')).toBe(true);
		nodes.filter((node) => node.type === 'button').find((button) => button.props.onClick && button.props.disabled === false && String(button.props.children).includes('Next')).props.onClick();
		expect(h.setPeriodCursor).toHaveBeenCalledWith('valid');
		const results = walk(UsageHistoryResults({ history: h, locale: 'en-GB' }));
		expect(results.filter((node) => node.type === 'th')).toHaveLength(6);
		expect(results.some((node) => node.type === 'a' && node.props.href.includes('recovery_01'))).toBe(true);
		results.filter((node) => node.type === 'button').at(-1).props.onClick();
		expect(h.setPage).toHaveBeenCalledWith(2);
	});

	it('current Free lifetime usage clearly has no billing period', () => {
		const free = { ...data, periodPage: { items: [], previousCursor: null, nextCursor: null },
			usagePagination: { ...data.usagePagination, billId: null, periodStart: null, periodEnd: null } };
		const h = history('READY', free);
		const nodes = walk(UsageHistoryResults({ history: h, locale: 'en-GB' }));
		expect(nodes.some((node) => node.type === 'h2' && node.props.children === 'Lifetime usage')).toBe(true);
		expect(walk(UsageHistoryToolbar({ history: h, locale: 'en-GB' })).filter((node) => node.type === 'select')).toHaveLength(2);
	});

	it('displays attributed charge source, unknown v2 evidence and legacy v1 distinctly', () => {
		expect(usageChargeLabel('LIFETIME_FREE_CREDITS')).toBe('Lifetime Free credits');
		expect(usageChargeLabel('INCLUDED_PLAN_ALLOWANCE')).toBe('Included plan allowance');
		expect(usageChargeLabel('PURCHASED_TOP_UP')).toBe('Purchased top-up');
		expect(usageChargeLabel('PROMOTIONAL_CREDITS')).toBe('Promotional credits');
		expect(usageChargeLabel('NOT_APPLICABLE')).toBe('Not applicable');
		expect(usageChargeLabel('UNATTRIBUTED')).toBe('Unattributed');
		expect(usageChargeLabel(undefined)).toBe('Not available');
		const v2 = {
			...data,
			schemaVersion: 2,
			usageEvents: [{ ...data.usageEvents[0], chargedAgainst: 'PURCHASED_TOP_UP', quantity: -1 }],
		};
		const rendered = walk(UsageHistoryResults({ history: history('READY', v2), locale: 'en-GB' }));
		const headers = rendered.filter((node) => node.type === 'th').map((node) => node.props.children);
		expect(headers).toEqual(['Event type', 'Recovery', 'Customer', 'Charged against', 'Quantity', 'Recorded at']);
		expect(rendered.filter((node) => node.type === 'td').map((node) => node.props.children))
			.toContain('Purchased top-up');
		const legacy = walk(UsageHistoryResults({ history: history('READY', data), locale: 'en-GB' }));
		expect(legacy.filter((node) => node.type === 'td').map((node) => node.props.children))
			.toContain('Not available');
	});

	it('uses translated admin locale formatting rather than a store language', () => {
		expect(usageFormatters('de-DE').formatNumber(1234)).toBe('1.234');
		expect(
			usageFormatters('en-GB').formatDate('2026-10-16T00:00:00Z')
		).toContain('2026');
	});

	it('routes native usage screen without replacing Billing or Purchase History', () => {
		expect(isNativeMerchantPage('?page=moda-interact-usage-history')).toBe(
			true
		);
		expect(
			initialMerchantSurface('?page=moda-interact-usage-history')
		).toBe('USAGE');
		expect(initialMerchantSurface('?page=moda-interact-billing')).toBe(
			'BILLING'
		);
	});
});
