import { describe, expect, it, vi } from 'vitest';
import {
	BILLING_PATH,
	BILLING_PLANS_PATH,
	createBillingClient,
	isWooConfirmationUrl,
	parseBillingPlans,
	parseBillingPresentation,
} from '../../src/billing-client';

function billing() {
	return {
		schemaVersion: 1,
		experienceState: 'ACTIVE',
		surfaces: {
			usageHistoryAllowed: true,
			purchaseHistoryAllowed: true,
			managePlansAllowed: true,
			cancelSubscriptionAllowed: false,
		},
		currentPlan: {
			merchantPricingPlanId: 'free_1',
			displayName: 'Free',
			planKind: 'FREE',
			recurringAmountMinor: 0,
			currency: 'USD',
			billingPeriod: 'EVERY_30_DAYS',
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			cancellationEffectiveAt: null,
		},
		pendingPlan: null,
		pendingCancellation: null,
		capacity: {
			paidIncluded: null,
			freeLifetime: {
				granted: 3,
				committed: 0,
				reserved: 0,
				remaining: 3,
			},
			promotional: {
				granted: 0,
				committed: 0,
				reserved: 0,
				remaining: 0,
			},
			purchased: {
				granted: 0,
				committed: 0,
				reserved: 0,
				refunding: 0,
				available: 0,
			},
		},
		topUps: {
			configured: false,
			purchaseEligible: false,
			offers: [],
			latestPurchase: null,
			unresolvedPurchases: [],
		},
	};
}

function planCatalogue() {
	return {
		schemaVersion: 1,
		resolvedLocale: 'en-GB',
		plans: [
			{
				merchantPricingPlanId: 'paid_1',
				displayName: 'Growth',
				planKind: 'PAID_METERED',
				cataloguePosition: 1,
				featured: true,
				localizedDescription: 'For growing shops.',
				includedRecoveryCredits: 100,
				allowancePeriod: 'EVERY_30_DAYS',
				billingPeriod: 'EVERY_30_DAYS',
				recurringAmountMinor: 1200,
				currency: 'USD',
				highlights: [],
			},
		],
	};
}

describe('billing local REST client', () => {
	it('accepts exact versioned presentation and plan catalogue contracts only', () => {
		expect(parseBillingPresentation(billing()).currentPlan.planKind).toBe(
			'FREE'
		);
		expect(parseBillingPlans(planCatalogue()).plans).toHaveLength(1);
		expect(() =>
			parseBillingPresentation({
				...billing(),
				providerContractId: 'leak',
			})
		).toThrow('remote_response_invalid');
		expect(() =>
			parseBillingPlans({ ...planCatalogue(), schemaVersion: 2 })
		).toThrow('remote_response_invalid');
	});

	it('allows only HTTPS confirmation URLs on exact Woo hosts', () => {
		expect(
			isWooConfirmationUrl('https://woocommerce.com/confirm/123')
		).toBe(true);
		expect(
			isWooConfirmationUrl('https://sandbox.woocommerce.com/confirm/123')
		).toBe(true);
		for (const url of [
			'http://woocommerce.com/confirm/123',
			'https://shop.woocommerce.com/confirm/123',
			'https://woocommerce.com.attacker.test/confirm/123',
			'https://user@woocommerce.com/confirm/123',
			'https://woocommerce.com/confirm/123#fragment',
		]) {
			expect(isWooConfirmationUrl(url)).toBe(false);
		}
	});

	it('uses only local REST paths and sends the exact browser command fields', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(billing())
			.mockResolvedValueOnce(planCatalogue())
			.mockResolvedValueOnce({
				schemaVersion: 1,
				operationId: 'operation_1',
				state: 'AWAITING_CONFIRMATION',
				confirmationUrl: 'https://woocommerce.com/confirm/1',
			});
		const client = createBillingClient(request);
		await client.getBilling();
		await client.getPlans();
		await client.createSubscription(
			'opaque_plan',
			'550e8400-e29b-41d4-a716-446655440000'
		);
		expect(request.mock.calls.map(([options]) => options.path)).toEqual([
			BILLING_PATH,
			BILLING_PLANS_PATH,
			`${BILLING_PATH}/subscription`,
		]);
		expect(request.mock.calls[2][0]).toMatchObject({
			method: 'POST',
			data: {
				merchantPricingPlanId: 'opaque_plan',
				actionId: '550e8400-e29b-41d4-a716-446655440000',
			},
		});
	});

	it('reduces unknown server errors to a bounded local category', async () => {
		const client = createBillingClient(
			vi
				.fn()
				.mockRejectedValue({ error: 'provider_secret_and_raw_payload' })
		);
		await expect(client.getBilling()).rejects.toThrow('remote_unavailable');
	});
});
