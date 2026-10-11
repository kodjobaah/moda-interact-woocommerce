import { describe, expect, it } from 'vitest';
import {
	canNavigateToWooRefund,
	parsePurchaseHistory,
	WOO_ORDERS_URL,
} from '../../src/billing/purchase-history-contract';

function purchase(overrides = {}) {
	return {
		id: 'purchase_1',
		status: 'ACTIVE',
		createdAt: '2026-10-11T01:00:00.000Z',
		activatedAt: '2026-10-11T01:01:00.000Z',
		bundleLabel: 'Bronze',
		planName: 'Free',
		creditsGranted: 1,
		currentAmount: 1,
		reservedAmount: 0,
		availableAmount: 1,
		heldForRefundAmount: 0,
		refundEligible: true,
		refundUnavailableReason: null,
		refundAttempted: false,
		latestRefund: null,
		completedRefund: null,
		originalProviderPurchase: { amount: '120.00', currency: 'USD' },
		...overrides,
	};
}
function history(overrides = {}) {
	return {
		schemaVersion: 1,
		filter: 'ACTIVE',
		page: 1,
		pageSize: 5,
		total: 1,
		totalPages: 1,
		purchases: [purchase()],
		refundRequest: { method: 'WOOCOMMERCE_ORDERS', url: WOO_ORDERS_URL },
		...overrides,
	};
}

describe('WooCommerce purchased history contract', () => {
	it('accepts the exact safe read model and renders a provider-owned link only for eligible, unattempted lots', () => {
		const current = parsePurchaseHistory(history());
		expect(canNavigateToWooRefund(current.purchases[0], current)).toBe(
			true
		);
		expect(
			canNavigateToWooRefund(
				purchase({
					refundEligible: false,
					refundUnavailableReason: 'NO_AVAILABLE_CREDITS',
				}),
				current
			)
		).toBe(false);
		expect(
			canNavigateToWooRefund(
				purchase({
					refundAttempted: true,
					refundEligible: false,
					refundUnavailableReason: 'REFUND_ALREADY_ATTEMPTED',
				}),
				current
			)
		).toBe(false);
	});

	it('rejects provider identifiers, price evidence outside the schema and redirected or forged refund links', () => {
		for (const value of [
			history({ providerReference: 'secret' }),
			history({
				purchases: [{ ...purchase(), providerContractId: 'secret' }],
			}),
			history({
				refundRequest: {
					method: 'WOOCOMMERCE_ORDERS',
					url: 'https://woocommerce.com.attacker.test/orders/',
				},
			}),
			history({
				refundRequest: { method: 'MODA_MUTATION', url: WOO_ORDERS_URL },
			}),
			history({
				purchases: [
					purchase({
						refundEligible: false,
						refundUnavailableReason: null,
					}),
				],
			}),
		]) {
			expect(() => parsePurchaseHistory(value)).toThrow(
				'remote_response_invalid'
			);
		}
	});

	it('requires bounded filters/pages and accepts an empty, server-clamped page', () => {
		expect(
			parsePurchaseHistory(
				history({ purchases: [], total: 0, totalPages: 1 })
			).purchases
		).toEqual([]);
		for (const value of [
			history({ filter: 'SHOPIFY' }),
			history({ pageSize: 999 }),
			history({ page: 2 }),
			history({ purchases: [purchase({ creditsGranted: -1 })] }),
		]) {
			expect(() => parsePurchaseHistory(value)).toThrow(
				'remote_response_invalid'
			);
		}
	});
});
