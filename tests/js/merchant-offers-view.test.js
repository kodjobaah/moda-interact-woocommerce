import { describe, expect, it, vi } from 'vitest';

vi.mock('@wordpress/element', () => ({
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
}));
vi.mock('@wordpress/i18n', () => ({
	__: (text) => text,
	sprintf: (format, ...values) => values.reduce((result, value, index) =>
		result.replace(new RegExp(`%${index + 1}\\$s|%s`), value), format),
}));

import { MerchantOffersView } from '../../src/recovery-settings/woo-coupons/merchant-offers-view';

function nodes(root) {
	if (!root || typeof root !== 'object') return [root];
	if (typeof root.type === 'function') return nodes(root.type({ ...root.props, children: root.children }));
	return [root, ...(root.children ?? []).flatMap(nodes)];
}
const labels = (root) => nodes(root).filter((n) => typeof n === 'string');
const buttons = (root) => nodes(root).filter((n) => n?.type === 'button');
const view = (state, dirty = false) => MerchantOffersView({ state, controller: {
	isDirty: () => dirty, setMode: vi.fn(), retryCoupons: vi.fn(), search: vi.fn(),
	previous: vi.fn(), next: vi.fn(), toggle: vi.fn(), save: vi.fn(), cancel: vi.fn(),
} });
const state = (mode, catalogueStatus) => ({
	status: 'READY', catalogueStatus, mode, page: null,
	selectedIds: [], history: [], offers: { merchant: { recoveryOfferMode: 'NONE' } },
	saving: false, error: null,
});

describe('ARCH-036-WOOCOMMERCE-004 mode-scoped presentation', () => {
	it.each(['NONE', 'AI_BEST_APPLICABLE'])(
		'hides catalogue controls and readiness messages for %s', (mode) => {
			const root = view(state(mode, 'NOT_READY'), mode !== 'NONE');
			const texts = labels(root);
			expect(texts).not.toContain('Retry coupons');
			expect(texts).not.toContain('Coupon synchronisation is pending or unavailable.');
			expect(nodes(root).filter((n) => n?.type === 'input' && n.props.type === 'checkbox')).toHaveLength(0);
			expect(buttons(root).find((n) => labels(n).includes('Save recovery behaviour')).props.disabled)
				.toBe(mode === 'NONE');
		}
	);

	it('shows a specific Retry only in FIXED mode after a non-current catalogue', () => {
		const root = view(state('FIXED', 'NOT_READY'), true);
		expect(labels(root)).toContain('Retry coupons');
		expect(labels(root)).toContain('Coupon synchronisation is pending or unavailable.');
		expect(buttons(root).find((n) => labels(n).includes('Save recovery behaviour')).props.disabled).toBe(true);
	});

	it('shows all provider code-usable rows, including custom/expired/zero-value and long codes', () => {
		const longCode = 'A'.repeat(4096);
		const rows = [
			{ id: 'a', code: longCode, title: longCode, summary: '0', providerType: 'WooCoupon:custom' },
			{ id: 'b', code: 'expired', title: 'expired', summary: 'expired', providerType: 'WooCoupon:fixed_cart' },
		];
		const root = view({ ...state('FIXED', 'READY'), selectedIds: ['b'],
			page: { items: rows, hasMore: false, nextCursor: null } }, true);
		const inputs = nodes(root).filter((n) => n?.type === 'input' && n.props.type === 'checkbox');
		expect(inputs).toHaveLength(2);
		expect(inputs.map((input) => input.props.disabled)).toEqual([false, false]);
		expect(inputs.map((input) => input.props.checked)).toEqual([false, true]);
		expect(labels(root)).toContain(longCode);
	});
});
