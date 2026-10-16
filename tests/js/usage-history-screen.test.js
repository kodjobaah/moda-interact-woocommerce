import { describe, expect, it, vi } from 'vitest';
import { UsageHistoryView } from '../../src/usage-history/usage-history-screen';
import { UsageHistoryToolbar } from '../../src/usage-history/usage-history-toolbar';
import { UsageHistoryResults } from '../../src/usage-history/usage-history-results';
import { usageFormatters } from '../../src/usage-history/usage-history-format';
import { initialMerchantSurface, isNativeMerchantPage } from '../../src/native-admin/page-surface';

function walk(node, result = []) {
	if (Array.isArray(node)) {
		node.forEach((child) => walk(child, result));
		return result;
	}
	if (!node || typeof node !== 'object' || !node.props) return result;
	result.push(node);
	walk(node.props.children, result);
	return result;
}
const history = (status, data = null) => ({
	state: { status, view: 'current', periodId: '', kind: 'ALL', periodCursor: '', pageSize: 10, page: 1, data },
	refresh: vi.fn(), setView: vi.fn(), setPeriod: vi.fn(), setKind: vi.fn(),
	setPageSize: vi.fn(), setPage: vi.fn(), setPeriodCursor: vi.fn(), clearCursor: vi.fn(),
});
const data = {
	periodPage: { items: [{ id: 'bill_one', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z' }], nextCursor: 'valid', previousCursor: null },
	usagePagination: { billId: 'bill_one', total: 24, totalQuantity: 24, page: 1, pageSize: 10, periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-11-01T00:00:00Z' },
	usageEvents: [{ id: 'event_1', metric: 'RECOVERY_CONVERSATION', quantity: 1, occurredAt: '2026-10-14T12:00:00Z', sourceRecovery: { recoveryId: 'recovery_01', customerName: 'Test User' } }],
};

describe('usage history presentation', () => {
	it.each(['IDLE', 'LOADING', 'UNAVAILABLE', 'DENIED', 'FAILED', 'INVALID_CURSOR', 'INVALID_PERIOD'])('renders a truthful %s state', (status) => {
		const ui = UsageHistoryView({ history: history(status) });
		const elements = walk(ui);
		expect(elements.some((node) => node.type === UsageHistoryToolbar)).toBe(true);
		expect(elements.some((node) => node.type === UsageHistoryResults)).toBe(true);
		expect(elements.some((node) => node.type === 'div' && ['status', 'alert'].includes(node.props.role))).toBe(true);
	});

	it('exposes period tabs, controlled filters and safe pagination', () => {
		const h = history('READY', data);
		const controls = UsageHistoryToolbar({ history: h, locale: 'de-DE' });
		const buttons = walk(controls).filter((node) => node.type === 'button');
		buttons.find((button) => button.props['aria-current'] === 'page').props.onClick();
		const selects = walk(controls).filter((node) => node.type === 'select');
		selects[0].props.onChange({ target: { value: 'bill_one' } });
		selects[1].props.onChange({ target: { value: 'RECOVERY_CONVERSATION' } });
		selects[2].props.onChange({ target: { value: '25' } });
		expect(h.setView).toHaveBeenCalledWith('current');
		expect(h.setPeriod).toHaveBeenCalledWith('bill_one');
		expect(h.setKind).toHaveBeenCalledWith('RECOVERY_CONVERSATION');
		expect(h.setPageSize).toHaveBeenCalledWith(25);
		const result = UsageHistoryResults({ history: h, locale: 'en-GB' });
		const nodes = walk(result);
		expect(nodes.filter((node) => node.type === 'th')).toHaveLength(5);
		expect(nodes.some((node) => node.type === 'a' && node.props.href.includes('recovery_01'))).toBe(true);
		nodes.filter((node) => node.type === 'button').at(-1).props.onClick();
		expect(h.setPage).toHaveBeenCalledWith(2);
	});

	it('uses translated admin locale formatting rather than a store language', () => {
		expect(usageFormatters('de-DE').formatNumber(1234)).toBe('1.234');
		expect(usageFormatters('en-GB').formatDate('2026-10-16T00:00:00Z')).toContain('2026');
	});

	it('routes native usage screen without replacing Billing or Purchase History', () => {
		expect(isNativeMerchantPage('?page=moda-interact-usage-history')).toBe(true);
		expect(initialMerchantSurface('?page=moda-interact-usage-history')).toBe('USAGE');
		expect(initialMerchantSurface('?page=moda-interact-billing')).toBe('BILLING');
	});
});
