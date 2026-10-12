import { describe, it, expect, vi } from 'vitest';
import {
	createCouponPreviewClient,
	parseCouponPreview,
} from '../../src/recovery-settings/woo-coupons/coupon-client';
import { CouponPreviewList } from '../../src/recovery-settings/woo-coupons/coupon-list';
import { RecoveryBehaviourFields } from '../../src/recovery-settings/recovery-behaviour-fields';

const example = {
	schemaVersion: 1,
	page: 1,
	pageSize: 10,
	total: 2,
	totalPages: 1,
	items: [
		{
			id: 1,
			code: 'TENOFF',
			type: 'percent',
			amount: '10',
			currency: 'GBP',
			previewStatus: 'REVIEW_REQUIRED',
		},
		{
			id: 2,
			code: 'PERSONAL',
			type: 'fixed_cart',
			amount: '5',
			currency: 'GBP',
			previewStatus: 'RESTRICTED',
		},
	],
};

function nodes(root, name) {
	const out = [];
	function visit(node) {
		if (Array.isArray(node)) {
			return node.forEach(visit);
		}
		if (node === null || typeof node !== 'object') {
			return;
		}
		if (typeof node.type === 'function') {
			return visit(node.type(node.props));
		}
		if (node.type === name) {
			out.push(node);
		}
		visit(node.props?.children);
	}
	visit(root);
	return out;
}

describe('ARCH-035 Woo coupon catalogue local preview', () => {
	it('parses bounded pages and rejects unknown fields or forged eligibility flags', () => {
		expect(parseCouponPreview(example).items).toHaveLength(2);
		for (const invalid of [
			{ ...example, installationId: 'wrong-shop' },
			{ ...example, items: [{ ...example.items[0], eligible: true }] },
			{
				...example,
				items: [{ ...example.items[0], code: 'x'.repeat(257) }],
			},
			{ ...example, pageSize: 10000 },
		]) {
			expect(() => parseCouponPreview(invalid)).toThrow();
		}
	});

	it('requests a bounded GET page without provider or shop identity', async () => {
		const fetcher = vi.fn().mockResolvedValue(example);
		const client = createCouponPreviewClient(fetcher);
		await expect(client.read({ page: 1, q: 'TEN' })).resolves.toEqual(
			example
		);
		expect(fetcher).toHaveBeenCalledWith({
			method: 'GET',
			path: '/moda-interact/v1/merchant/recovery-coupons?page=1&q=TEN',
		});
		await expect(client.read({ q: 'a'.repeat(81) })).rejects.toThrow();
	});

	it('renders only preliminary catalogue choices, never a save action', () => {
		const onSelect = vi.fn();
		const row = CouponPreviewList({
			items: example.items,
			selectedId: null,
			onSelect,
		});
		const radios = nodes(row, 'input');
		expect(radios).toHaveLength(2);
		expect(radios[0].props.disabled).toBe(false);
		expect(radios[1].props.disabled).toBe(true);
		radios[0].props.onChange();
		expect(onSelect).toHaveBeenCalledWith(1);
		expect(nodes(row, 'button')).toHaveLength(0);
	});

	it('does not couple local preview selection to recovery-behaviour save', () => {
		const marker = { type: 'local-preview-only', props: {} };
		const fields = RecoveryBehaviourFields({
			couponPreview: marker,
			effective: { recoveryOfferMode: 'NONE', recoveryDelayMinutes: 30 },
			draft: {
				recoveryDelayMinutes: '30',
				followUpDelayMinutes: '',
				followUpEnabled: false,
			},
			errors: { start: false, followUp: false },
			ready: true,
			onChange: vi.fn(),
		});
		expect(nodes(fields, 'local-preview-only')).toHaveLength(1);
	});
});
