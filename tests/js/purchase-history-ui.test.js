import { describe, expect, it, vi } from 'vitest';
import { PurchaseRefundGuidance } from '../../src/billing/purchase-history-guidance';
import { PurchaseHistoryScreen } from '../../src/billing/purchase-history-screen';
import { PurchaseHistoryFilters } from '../../src/billing/purchase-history-filters';
import { PurchaseHistoryPagination } from '../../src/billing/purchase-history-pagination';
import { createPurchaseHistoryClient } from '../../src/billing/purchase-history-client';
import { WOO_ORDERS_URL } from '../../src/billing/purchase-history-contract';

function find(node, predicate, result = []) {
	if (Array.isArray(node)) {
		node.forEach((child) => find(child, predicate, result));
	} else if (node && typeof node === 'object' && node.props) {
		if (predicate(node)) {
			result.push(node);
		}
		find(node.props.children, predicate, result);
	}
	return result;
}
const purchase = {
	status: 'ACTIVE',
	refundEligible: true,
	refundAttempted: false,
};
const data = {
	refundRequest: { method: 'WOOCOMMERCE_ORDERS', url: WOO_ORDERS_URL },
};

describe('Woo purchased credit UI', () => {
	it('renders exactly the approved external provider link for eligible purchases', () => {
		const view = PurchaseRefundGuidance({ purchase, data });
		const links = find(view, (node) => node.type === 'a');
		expect(links).toHaveLength(1);
		expect(links[0].props).toMatchObject({
			href: WOO_ORDERS_URL,
			target: '_blank',
			rel: 'noopener noreferrer',
		});
		for (const row of [
			{ ...purchase, refundEligible: false },
			{ ...purchase, refundAttempted: true },
			{ ...purchase, status: 'WITHDRAWN' },
		]) {
			expect(
				find(
					PurchaseRefundGuidance({ purchase: row, data }),
					(node) => node.type === 'a'
				)
			).toHaveLength(0);
		}
	});

	it('keeps history inside Billing, without a local refund dialog or selection form', () => {
		const history = {
			state: {
				status: 'READY',
				filter: 'ACTIVE',
				pageSize: 5,
				data: {
					...data,
					page: 1,
					pageSize: 5,
					total: 0,
					totalPages: 1,
					purchases: [],
				},
			},
			setFilter: vi.fn(),
			setPage: vi.fn(),
			setPageSize: vi.fn(),
			refresh: vi.fn(),
		};
		const view = PurchaseHistoryScreen({
			history,
			onBack: vi.fn(),
			locale: 'en-US',
		});
		expect(
			find(view, (node) => node.type === PurchaseHistoryFilters)
		).toHaveLength(1);
		expect(
			find(view, (node) => node.type === PurchaseHistoryPagination)
		).toHaveLength(1);
		expect(
			find(view, (node) => node.type === 'form' || node.type === 'dialog')
		).toHaveLength(0);
	});

	it('issues a GET to the local WordPress proxy with bounded query only', async () => {
		const request = vi.fn().mockResolvedValue({
			schemaVersion: 1,
			filter: 'ACTIVE',
			page: 1,
			pageSize: 5,
			total: 0,
			totalPages: 1,
			purchases: [],
			refundRequest: data.refundRequest,
		});
		const result = await createPurchaseHistoryClient(request).getHistory(
			'ACTIVE',
			1,
			5
		);
		expect(result.total).toBe(0);
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/moda-interact/v1/billing/recovery-credit-purchases?filter=ACTIVE&page=1&pageSize=5',
				method: 'GET',
			})
		);
		expect(request.mock.calls[0][0]).not.toHaveProperty('data');
	});
});
