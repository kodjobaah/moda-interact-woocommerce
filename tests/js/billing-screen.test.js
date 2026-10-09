import { describe, expect, it, vi } from 'vitest';
import { BillingSummaryView, PlanCard } from '../../src/billing-screen';

function textContent(node) {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}
	if (Array.isArray(node)) {
		return node.map(textContent).join(' ');
	}
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}
	return [node.props?.title, textContent(node.props?.children)]
		.filter(Boolean)
		.join(' ');
}

function presentation(overrides = {}) {
	return {
		schemaVersion: 1,
		experienceState: 'ACTIVE',
		surfaces: {
			usageHistoryAllowed: false,
			purchaseHistoryAllowed: false,
			managePlansAllowed: true,
			cancelSubscriptionAllowed: false,
		},
		currentPlan: {
			merchantPricingPlanId: 'plan_free',
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
				granted: 4,
				committed: 1,
				reserved: 0,
				remaining: 3,
			},
			promotional: {
				granted: 5,
				committed: 1,
				reserved: 0,
				remaining: 4,
			},
			purchased: {
				granted: 12,
				committed: 2,
				reserved: 1,
				refunding: 0,
				available: 9,
			},
		},
		topUps: {
			configured: false,
			purchaseEligible: false,
			offers: [],
			latestPurchase: null,
			unresolvedPurchases: [],
		},
		...overrides,
	};
}

function summary(data, state) {
	return BillingSummaryView({
		data,
		state,
		onCancel: vi.fn(),
		cancelDialogOpen: false,
		setCancelDialogOpen: vi.fn(),
		keepPlanRef: { current: null },
		dialogCancelRef: { current: null },
		cancelTriggerRef: { current: null },
	});
}

function readyState(data, overrides = {}) {
	return {
		status: 'READY',
		data,
		plansStatus: 'IDLE',
		plans: null,
		view: 'SUMMARY',
		command: null,
		notice: null,
		error: null,
		...overrides,
	};
}

describe('Billing screen', () => {
	it('presents Free as a normal plan and uses only API capacity totals', () => {
		const content = textContent(
			summary(presentation(), readyState(presentation()))
		);
		expect(content).toContain('Current plan');
		expect(content).toContain('No recurring charge');
		expect(content).toContain('Lifetime Free credits remaining');
		expect(content).toContain('Purchased credits available');
		expect(content).toContain('9');
		expect(content).not.toMatch(
			/Buy credits|Manage purchases|Refund|Reactivate/
		);
	});

	it('separates the allowance reset from verified paid cancellation end', () => {
		const data = presentation({
			currentPlan: {
				merchantPricingPlanId: 'plan_paid',
				displayName: 'Growth',
				planKind: 'PAID_METERED',
				recurringAmountMinor: 1200,
				currency: 'USD',
				billingPeriod: 'EVERY_30_DAYS',
				currentPeriodEnd: '2026-11-01T00:00:00Z',
				cancelAtPeriodEnd: true,
				cancellationEffectiveAt: '2026-11-15T00:00:00Z',
			},
		});
		const content = textContent(summary(data, readyState(data)));
		expect(content).toContain('Next included allowance reset');
		expect(content).toContain('Paid subscription ends');
		expect(content).toContain('Scheduled to end');
		expect(content).toContain('$12.00');
	});

	it('explains FROZEN capacity without claiming all credits are unavailable', () => {
		const data = presentation({
			experienceState: 'FROZEN',
			currentPlan: {
				merchantPricingPlanId: 'plan_paid',
				displayName: 'Growth',
				planKind: 'PAID_METERED',
				recurringAmountMinor: 1200,
				currency: 'USD',
				billingPeriod: 'EVERY_30_DAYS',
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
				cancellationEffectiveAt: null,
			},
			capacity: {
				...presentation().capacity,
				paidIncluded: {
					granted: 100,
					currentAllowance: 100,
					committed: 3,
					reserved: 1,
					forfeited: 0,
					remaining: 96,
				},
			},
		});
		const content = textContent(summary(data, readyState(data)));
		expect(content).toContain('Recurring billing recovery is required');
		expect(content).toContain(
			'Paid included credits are temporarily unavailable'
		);
		expect(content).toContain(
			'Purchased credits and remaining lifetime Free credits remain usable'
		);
		expect(content).toContain('Temporarily unavailable');
		expect(content).toContain('3');
		expect(content).toContain('9');
	});

	it.each([
		['INITIATING', 'Starting the plan change'],
		['AWAITING_CONFIRMATION', 'Waiting for Woo confirmation'],
		['OUTCOME_UNKNOWN', 'Do not retry it automatically'],
	])(
		'presents pending plan state %s without retry actions',
		(status, text) => {
			const data = presentation({
				pendingPlan: {
					merchantPricingPlanId: 'plan_next',
					displayName: 'Growth',
					recurringAmountMinor: 1200,
					currency: 'USD',
					billingPeriod: 'EVERY_30_DAYS',
					state: status,
				},
			});
			const content = textContent(summary(data, readyState(data)));
			expect(content).toContain(text);
			expect(content).not.toMatch(/Retry plan|Try again automatically/);
		}
	);

	it.each(['INITIATING', 'OUTCOME_UNKNOWN', 'CONFIRMED'])(
		'presents pending cancellation state %s',
		(status) => {
			const data = presentation({
				pendingCancellation: { state: status },
			});
			const expectedText = {
				INITIATING: 'Starting the cancellation request',
				OUTCOME_UNKNOWN: 'needs reconciliation',
				CONFIRMED: 'Woo accepted the request',
			}[status];
			expect(textContent(summary(data, readyState(data)))).toContain(
				expectedText
			);
		}
	);

	it('renders eligible plans and disables unsupported frozen plan actions', () => {
		const plan = {
			merchantPricingPlanId: 'plan_paid',
			displayName: 'Growth',
			planKind: 'PAID_METERED',
			cataloguePosition: 1,
			featured: true,
			localizedDescription: 'For busy stores.',
			includedRecoveryCredits: 100,
			allowancePeriod: 'EVERY_30_DAYS',
			billingPeriod: 'EVERY_30_DAYS',
			recurringAmountMinor: 1200,
			currency: 'USD',
			highlights: [],
		};
		const data = presentation();
		const element = PlanCard({
			plan,
			data,
			state: readyState(data),
			onSelect: vi.fn(),
		});
		const content = textContent(element);
		expect(content).toContain('For busy stores.');
		expect(content).toContain('Featured');
		expect(content).toContain('Choose plan');
		expect(content).not.toMatch(/providerContractId|shopifyPlanHandle/);

		const frozenData = presentation({ experienceState: 'FROZEN' });
		const frozen = PlanCard({
			plan,
			data: frozenData,
			state: readyState(frozenData),
			onSelect: vi.fn(),
		});
		expect(frozen.props.children.at(-1).props.disabled).toBe(true);
		expect(textContent(frozen)).toContain('Unavailable');
	});
});
