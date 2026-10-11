import { describe, expect, it, vi } from 'vitest';
import {
	BillingSummaryView,
	BillingScreen,
	PlanCard,
	formatDate,
	formatMoney,
	formatQuantity,
	resolveBillingLocale,
	restoreCancelDialogFocus,
	BillingHero,
	TopUpSection,
} from '../../src/billing-screen';
import { CapacitySummary } from '../../src/billing/capacity-summary';

function textContent(node) {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}
	if (Array.isArray(node)) {
		return node.map(textContent).join(' ');
	}
	if (node.type === CapacitySummary) {
		return textContent(CapacitySummary(node.props));
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

function topUpData(overrides = {}) {
	return presentation({
		topUps: {
			configured: true,
			purchaseEligible: true,
			offers: [
				{
					merchantPricingUsageEventId: 'usage_bronze_private',
					label: 'Bronze',
					creditsGranted: 10,
					amountMinor: 1000,
					currency: 'USD',
					purchaseEligible: true,
					unavailableReason: null,
				},
				{
					merchantPricingUsageEventId: 'usage_silver_private',
					label: 'Silver',
					creditsGranted: 25,
					amountMinor: 2000,
					currency: 'USD',
					purchaseEligible: true,
					unavailableReason: null,
				},
			],
			latestPurchase: null,
			unresolvedPurchases: [],
			...overrides,
		},
	});
}

function findElements(node, predicate, result = []) {
	if (Array.isArray(node)) {
		for (const child of node) {
			findElements(child, predicate, result);
		}
	} else if (node && typeof node === 'object' && node.props) {
		if (predicate(node)) {
			result.push(node);
		}
		findElements(node.props.children, predicate, result);
	}
	return result;
}

describe('Billing screen', () => {
	it('renders only configured offers and keeps event IDs out of merchant-facing content', () => {
		const data = topUpData();
		const onPurchase = vi.fn();
		const section = TopUpSection({
			data,
			state: readyState(data),
			onPurchase,
			locale: 'en-US',
		});
		const buttons = findElements(section, (node) => node.type === 'button');
		const content = textContent(section);

		expect(content).toContain('Bronze');
		expect(content).toContain('$10.00');
		expect(content).toContain('Buy 10 credits');
		expect(content).not.toContain('usage_bronze_private');
		expect(buttons).toHaveLength(2);
		buttons[0].props.onClick();
		expect(onPurchase).toHaveBeenCalledWith('usage_bronze_private');
		expect(
			TopUpSection({
				data: topUpData({ configured: false }),
				state: readyState(data),
				onPurchase,
			})
		).toBeNull();
		expect(
			TopUpSection({
				data: topUpData({ offers: [] }),
				state: readyState(data),
				onPurchase,
			})
		).toBeNull();
	});

	it('shows per-bundle pending and unknown states without blocking other offers', () => {
		const data = topUpData({
			offers: [
				{
					...topUpData().topUps.offers[0],
					purchaseEligible: false,
					unavailableReason: 'PENDING_PURCHASE',
				},
				topUpData().topUps.offers[1],
			],
			unresolvedPurchases: [
				{
					merchantPricingUsageEventId: 'usage_bronze_private',
					operationState: 'OUTCOME_UNKNOWN',
				},
			],
		});
		const section = TopUpSection({
			data,
			state: readyState(data),
			onPurchase: vi.fn(),
			locale: 'en-US',
		});
		const buttons = findElements(section, (node) => node.type === 'button');
		const content = textContent(section);

		expect(content).toContain(
			'Confirmation needs reconciliation. Do not retry this bundle yet.'
		);
		expect(buttons).toHaveLength(1);
		expect(buttons[0].props.disabled).toBe(false);
	});

	it.each([
		['INITIATING', 'Starting purchase'],
		['AWAITING_CONFIRMATION', 'Waiting for Woo confirmation'],
		[
			'OUTCOME_UNKNOWN',
			'Confirmation needs reconciliation. Do not retry this bundle yet.',
		],
		['CONFIRMED', 'Payment confirmed. Credits are being activated.'],
	])(
		'presents unresolved operation state %s without a retry control',
		(operationState, message) => {
			const data = topUpData({
				offers: [
					{
						...topUpData().topUps.offers[0],
						purchaseEligible: false,
						unavailableReason: 'PENDING_PURCHASE',
					},
				],
				unresolvedPurchases: [
					{
						merchantPricingUsageEventId: 'usage_bronze_private',
						operationState,
					},
				],
			});
			const section = TopUpSection({
				data,
				state: readyState(data),
				onPurchase: vi.fn(),
				locale: 'en-US',
			});

			expect(textContent(section)).toContain(message);
			expect(
				findElements(section, (node) => node.type === 'button')
			).toHaveLength(0);
		}
	);

	it('disables every Buy action when global eligibility or a command lock is active', () => {
		const data = topUpData({ purchaseEligible: false });
		const section = TopUpSection({
			data,
			state: readyState(data),
			onPurchase: vi.fn(),
			locale: 'en-US',
		});
		const buttons = findElements(section, (node) => node.type === 'button');
		expect(buttons).toHaveLength(2);
		expect(buttons.every((button) => button.props.disabled)).toBe(true);

		const lockedData = topUpData();
		const locked = TopUpSection({
			data: lockedData,
			state: readyState(lockedData, { command: 'SUBMITTING' }),
			onPurchase: vi.fn(),
			locale: 'en-US',
		});
		expect(
			findElements(locked, (node) => node.type === 'button').every(
				(button) => button.props.disabled
			)
		).toBe(true);
	});

	it('keeps frozen and pending-operation notices visible in Plans view', () => {
		const data = presentation({
			experienceState: 'FROZEN',
			pendingPlan: {
				merchantPricingPlanId: 'plan_next',
				displayName: 'Growth',
				state: 'AWAITING_CONFIRMATION',
			},
		});
		const screen = BillingScreen({
			state: readyState(data, { view: 'PLANS' }),
			onRefresh: vi.fn(),
			onLoadPlans: vi.fn(),
			onSelectPlan: vi.fn(),
			onCancel: vi.fn(),
			onSetView: vi.fn(),
		});
		const content = textContent(screen);

		expect(content).toContain('Waiting for Woo confirmation');
		expect(content).toContain(
			'Paid included credits are temporarily unavailable'
		);
	});

	it('keeps Billing hero actions accessible and respects plan availability', () => {
		const data = presentation({
			surfaces: {
				...presentation().surfaces,
				managePlansAllowed: false,
			},
		});
		const onRefresh = vi.fn();
		const onSetView = vi.fn();
		const hero = BillingHero({
			state: readyState(data, { view: 'SUMMARY' }),
			onRefresh,
			onSetView,
		});
		const summaryTab = findElement(
			hero,
			(node) =>
				node.props.role === 'tab' && textContent(node) === 'Summary'
		);
		const plansTab = findElement(
			hero,
			(node) => node.props.role === 'tab' && textContent(node) === 'Plans'
		);
		const refreshButton = findElement(
			hero,
			(node) =>
				node.type === 'button' &&
				textContent(node) === 'Refresh billing'
		);

		expect(summaryTab.props['aria-selected']).toBe(true);
		expect(plansTab.props.disabled).toBe(true);
		plansTab.props.onClick();
		expect(onSetView).toHaveBeenCalledWith('PLANS');
		refreshButton.props.onClick();
		expect(onRefresh).toHaveBeenCalledOnce();
	});

	it('uses normalized administrator locale before site and English fallbacks', () => {
		const locale = resolveBillingLocale({ user: 'de_DE', site: 'fr_FR' });
		expect(locale).toBe('de-DE');
		expect(formatQuantity(12345, locale)).toBe(
			new Intl.NumberFormat('de-DE').format(12345)
		);
		expect(formatMoney(123456, 'EUR', locale)).toBe(
			new Intl.NumberFormat('de-DE', {
				style: 'currency',
				currency: 'EUR',
			}).format(1234.56)
		);
		expect(formatDate('2026-10-10T00:00:00Z', locale)).toBe(
			new Intl.DateTimeFormat('de-DE', {
				dateStyle: 'medium',
				timeZone: 'UTC',
			}).format(new Date('2026-10-10T00:00:00Z'))
		);
	});

	it('falls back from invalid administrator locale to site locale then English', () => {
		expect(
			resolveBillingLocale({ user: 'bad_locale!', site: 'fr_FR' })
		).toBe('fr-FR');
		expect(
			resolveBillingLocale({ user: 'bad_locale!', site: 'also bad!' })
		).toBe('en');
	});

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
		['plan change', 'PLAN_CHANGE'],
		['cancellation', 'CANCELLATION'],
	])(
		'does not show purchase failure copy for a %s failure when offers are visible',
		(_label, feedbackContext) => {
			const data = topUpData();
			const state = readyState(data, {
				error: 'billing_operation_failed',
				feedbackContext,
			});
			const tree = BillingScreen({
				state,
				onRefresh: vi.fn(),
				onLoadPlans: vi.fn(),
				onSelectPlan: vi.fn(),
				onCancel: vi.fn(),
				onPurchaseTopUp: vi.fn(),
				onSetView: vi.fn(),
			});
			const content = textContent(tree);
			const topUpContent = textContent(
				TopUpSection({
					data,
					state,
					onPurchase: vi.fn(),
					locale: 'en-US',
				})
			);

			expect(topUpContent).toContain('Bronze');
			expect(topUpContent).toContain('Silver');
			expect(content).toContain('Your current plan remains unchanged.');
			expect(topUpContent).not.toContain(
				'The purchase could not be started.'
			);
		}
	);

	it('shows top-up failure copy without recurring-plan failure copy', () => {
		const data = topUpData();
		const state = readyState(data, {
			error: 'billing_operation_failed',
			feedbackContext: 'TOP_UP',
		});
		const tree = BillingScreen({
			state,
			onRefresh: vi.fn(),
			onLoadPlans: vi.fn(),
			onSelectPlan: vi.fn(),
			onCancel: vi.fn(),
			onPurchaseTopUp: vi.fn(),
			onSetView: vi.fn(),
		});
		const content = textContent(tree);
		const topUpContent = textContent(
			TopUpSection({
				data,
				state,
				onPurchase: vi.fn(),
				locale: 'en-US',
			})
		);

		expect(topUpContent).toContain('Bronze');
		expect(topUpContent).toContain('Silver');
		expect(topUpContent).toContain('The purchase could not be started.');
		expect(content).not.toContain('Your current plan remains unchanged.');
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
