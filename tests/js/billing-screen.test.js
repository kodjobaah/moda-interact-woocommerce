import { describe, expect, it, vi } from 'vitest';
import {
	BillingSummaryView,
	PlanCard,
	restoreCancelDialogFocus,
} from '../../src/billing-screen';

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

function summary(data, state, options = {}) {
	return BillingSummaryView({
		data,
		state,
		onCancel: options.onCancel ?? vi.fn(),
		cancelDialogOpen: options.cancelDialogOpen ?? false,
		setCancelDialogOpen: options.setCancelDialogOpen ?? vi.fn(),
		keepPlanRef: options.keepPlanRef ?? { current: null },
		dialogCancelRef: options.dialogCancelRef ?? { current: null },
		cancelTriggerRef: options.cancelTriggerRef ?? { current: null },
		locale: options.locale,
	});
}

function findElement(node, predicate) {
	if (Array.isArray(node)) {
		return node.map((child) => findElement(child, predicate)).find(Boolean);
	}
	if (!node || typeof node !== 'object' || !node.props) {
		return undefined;
	}
	if (predicate(node)) {
		return node;
	}
	return findElement(node.props.children, predicate);
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

	it.each(['en-US', 'de-DE'])(
		'formats capacity and plan quantities for locale %s',
		(locale) => {
			const data = presentation({
				currentPlan: {
					...presentation().currentPlan,
					merchantPricingPlanId: 'plan_paid',
					planKind: 'PAID_METERED',
				},
				surfaces: {
					...presentation().surfaces,
					cancelSubscriptionAllowed: true,
				},
				capacity: {
					paidIncluded: { remaining: 12345 },
					freeLifetime: { remaining: 23456 },
					promotional: { remaining: 34567 },
					purchased: { available: 45678 },
				},
			});
			const content = textContent(
				summary(data, readyState(data), { locale })
			);
			for (const quantity of [12345, 23456, 34567, 45678]) {
				expect(content).toContain(
					new Intl.NumberFormat(locale).format(quantity)
				);
			}

			const plan = {
				merchantPricingPlanId: 'plan_paid',
				displayName: 'Growth',
				planKind: 'PAID_METERED',
				cataloguePosition: 1,
				featured: false,
				localizedDescription: 'For busy stores.',
				includedRecoveryCredits: 56789,
				allowancePeriod: 'EVERY_30_DAYS',
				billingPeriod: 'EVERY_30_DAYS',
				recurringAmountMinor: 1200,
				currency: 'USD',
				highlights: [],
			};
			expect(
				textContent(
					PlanCard({
						plan,
						data,
						state: readyState(data),
						onSelect: vi.fn(),
						locale,
					})
				)
			).toContain(new Intl.NumberFormat(locale).format(56789));
		}
	);

	it('cycles dialog focus at the edges and restores focus after dismissal', () => {
		const data = presentation({
			currentPlan: {
				...presentation().currentPlan,
				merchantPricingPlanId: 'plan_paid',
				planKind: 'PAID_METERED',
			},
			surfaces: {
				...presentation().surfaces,
				cancelSubscriptionAllowed: true,
			},
		});
		const setCancelDialogOpen = vi.fn();
		const onCancel = vi.fn();
		const tree = summary(data, readyState(data), {
			cancelDialogOpen: true,
			setCancelDialogOpen,
			onCancel,
		});
		const dialog = findElement(
			tree,
			(node) => node.props.role === 'alertdialog'
		);
		const document = { activeElement: null };
		const keepButton = {
			focus() {
				document.activeElement = keepButton;
			},
		};
		const confirmButton = {
			focus() {
				document.activeElement = confirmButton;
			},
		};
		const event = (key, shiftKey = false) => ({
			key,
			shiftKey,
			currentTarget: {
				ownerDocument: document,
				querySelectorAll: () => [keepButton, confirmButton],
			},
			preventDefault: vi.fn(),
		});

		keepButton.focus();
		const forwardInside = event('Tab');
		dialog.props.onKeyDown(forwardInside);
		expect(forwardInside.preventDefault).not.toHaveBeenCalled();
		confirmButton.focus();

		const reverseInside = event('Tab', true);
		dialog.props.onKeyDown(reverseInside);
		expect(reverseInside.preventDefault).not.toHaveBeenCalled();
		keepButton.focus();

		const reverseAtStart = event('Tab', true);
		dialog.props.onKeyDown(reverseAtStart);
		expect(reverseAtStart.preventDefault).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(confirmButton);

		const forwardAtEnd = event('Tab');
		dialog.props.onKeyDown(forwardAtEnd);
		expect(forwardAtEnd.preventDefault).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(keepButton);

		const escape = event('Escape');
		dialog.props.onKeyDown(escape);
		expect(escape.preventDefault).toHaveBeenCalledOnce();
		expect(setCancelDialogOpen).toHaveBeenCalledWith(false);
		expect(onCancel).not.toHaveBeenCalled();

		const cancelTrigger = {
			focus: vi.fn(() => {
				document.activeElement = cancelTrigger;
			}),
		};
		restoreCancelDialogFocus({ current: cancelTrigger });
		expect(cancelTrigger.focus).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(cancelTrigger);
	});

	it('requires the explicit confirmation button to submit cancellation', () => {
		const data = presentation({
			currentPlan: {
				...presentation().currentPlan,
				merchantPricingPlanId: 'plan_paid',
				planKind: 'PAID_METERED',
			},
			surfaces: {
				...presentation().surfaces,
				cancelSubscriptionAllowed: true,
			},
		});
		const onCancel = vi.fn();
		const setCancelDialogOpen = vi.fn();
		const tree = summary(data, readyState(data), {
			cancelDialogOpen: true,
			setCancelDialogOpen,
			onCancel,
		});
		const dialog = findElement(
			tree,
			(node) => node.props.role === 'alertdialog'
		);
		const buttons = [];
		const collectButtons = (node) => {
			if (Array.isArray(node)) {
				node.forEach(collectButtons);
			} else if (node?.props) {
				if (node.type === 'button') {
					buttons.push(node);
				}
				collectButtons(node.props.children);
			}
		};
		collectButtons(dialog);

		buttons
			.find((button) => textContent(button).includes('Keep current plan'))
			.props.onClick();
		expect(onCancel).not.toHaveBeenCalled();
		buttons
			.find((button) =>
				textContent(button).includes('Confirm cancellation')
			)
			.props.onClick();
		expect(setCancelDialogOpen).toHaveBeenCalledWith(false);
		expect(onCancel).toHaveBeenCalledOnce();
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
