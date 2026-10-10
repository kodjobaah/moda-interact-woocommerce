import { describe, expect, it, vi } from 'vitest';
import {
	BillingController,
	canPurchaseRecoveryCredits,
	createBillingActionId,
	isBillingReturn,
	planActionFor,
} from '../../src/billing-controller';

function plan(id = 'paid_1') {
	return {
		merchantPricingPlanId: id,
		planKind: 'PAID_METERED',
	};
}

function billing(overrides = {}) {
	return {
		experienceState: 'ACTIVE',
		surfaces: {
			managePlansAllowed: true,
			cancelSubscriptionAllowed: true,
		},
		currentPlan: {
			merchantPricingPlanId: 'free_1',
			planKind: 'FREE',
			cancelAtPeriodEnd: false,
		},
		pendingPlan: null,
		pendingCancellation: null,
		...overrides,
	};
}

function topUps(overrides = {}) {
	return {
		configured: true,
		purchaseEligible: true,
		offers: [
			{
				merchantPricingUsageEventId: 'usage_bronze',
				purchaseEligible: true,
			},
			{
				merchantPricingUsageEventId: 'usage_silver',
				purchaseEligible: true,
			},
		],
		unresolvedPurchases: [],
		...overrides,
	};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe('BillingController', () => {
	it('applies global and offer eligibility independently and blocks only unresolved bundles', () => {
		const data = billing({
			topUps: topUps({
				unresolvedPurchases: [
					{ merchantPricingUsageEventId: 'usage_bronze' },
				],
			}),
		});
		expect(canPurchaseRecoveryCredits(data, 'usage_bronze')).toBe(false);
		expect(canPurchaseRecoveryCredits(data, 'usage_silver')).toBe(true);
		expect(
			canPurchaseRecoveryCredits(
				billing({ topUps: topUps({ purchaseEligible: false }) }),
				'usage_silver'
			)
		).toBe(false);
		expect(
			canPurchaseRecoveryCredits(
				billing({
					topUps: topUps({
						offers: [
							{
								merchantPricingUsageEventId: 'usage_silver',
								purchaseEligible: false,
							},
						],
					}),
				}),
				'usage_silver'
			)
		).toBe(false);
	});

	it('waits for CONNECTED and shares one billing read', async () => {
		const pending = deferred();
		const client = { getBilling: vi.fn(() => pending.promise) };
		const controller = new BillingController(client);
		await controller.refresh();
		expect(client.getBilling).not.toHaveBeenCalled();
		controller.setConnectionStatus('CONNECTED');
		expect(client.getBilling).not.toHaveBeenCalled();
		controller.setActive(true);
		const first = controller.refresh();
		const second = controller.refresh();
		expect(client.getBilling).toHaveBeenCalledTimes(1);
		pending.resolve(billing());
		await Promise.all([first, second]);
		expect(controller.state.status).toBe('READY');
	});

	it('clears billing data and ignores a late response after disconnect', async () => {
		const pending = deferred();
		const controller = new BillingController({
			getBilling: () => pending.promise,
		});
		controller.setActive(true);
		controller.setConnectionStatus('CONNECTED');
		controller.setConnectionStatus('RECONNECT_REQUIRED');
		expect(controller.state).toMatchObject({ status: 'IDLE', data: null });
		pending.resolve(billing());
		await controller.billingPromise;
		expect(controller.state).toMatchObject({ status: 'IDLE', data: null });
	});

	it('blocks plan commands during an unresolved authoritative billing refresh', async () => {
		const lateRead = deferred();
		const command = deferred();
		const client = {
			getBilling: vi
				.fn()
				.mockResolvedValueOnce(billing())
				.mockReturnValueOnce(lateRead.promise),
			createSubscription: vi.fn(() => command.promise),
		};
		const controller = new BillingController(client);
		controller.setActive(true);
		controller.setConnectionStatus('CONNECTED');
		const oldRead = controller.billingPromise;
		await oldRead;
		const staleRefresh = controller.refresh();
		await controller.createOrSwitch(plan());
		expect(client.createSubscription).not.toHaveBeenCalled();
		lateRead.resolve(billing());
		await staleRefresh;
		expect(controller.state.status).toBe('READY');
		const submission = controller.createOrSwitch(plan());
		await Promise.resolve();
		expect(controller.state.command).toBe('SUBMITTING');
		command.resolve({
			confirmationUrl: 'https://woocommerce.com/confirm/1',
		});
		await submission;
	});

	it('ignores a late plan catalogue after disconnect', async () => {
		const plans = deferred();
		const client = {
			getBilling: vi.fn().mockResolvedValue(billing()),
			getPlans: vi.fn(() => plans.promise),
		};
		const controller = new BillingController(client);
		controller.setActive(true);
		controller.setConnectionStatus('CONNECTED');
		await controller.billingPromise;
		controller.setView('PLANS');
		controller.setConnectionStatus('DISCONNECTED');
		plans.resolve({ plans: [plan()] });
		await controller.plansPromise;
		expect(controller.state.plans).toBeNull();
		expect(controller.state.status).toBe('IDLE');
	});

	it('loads the catalogue only after opening Plans and only when allowed', async () => {
		const client = {
			getBilling: vi.fn().mockResolvedValue(billing()),
			getPlans: vi.fn().mockResolvedValue({ plans: [plan()] }),
		};
		const controller = new BillingController(client);
		controller.setActive(true);
		controller.setConnectionStatus('CONNECTED');
		await controller.billingPromise;
		expect(client.getPlans).not.toHaveBeenCalled();
		await controller.setView('PLANS');
		expect(client.getPlans).toHaveBeenCalledTimes(1);

		const blockedClient = {
			getBilling: vi.fn().mockResolvedValue(
				billing({
					surfaces: {
						managePlansAllowed: false,
						cancelSubscriptionAllowed: false,
					},
				})
			),
			getPlans: vi.fn(),
		};
		const blocked = new BillingController(blockedClient);
		blocked.setActive(true);
		blocked.setConnectionStatus('CONNECTED');
		await blocked.billingPromise;
		await blocked.setView('PLANS');
		expect(blockedClient.getPlans).not.toHaveBeenCalled();
	});

	it('selects only the supported create and switch actions and fails closed for transitions', () => {
		expect(planActionFor(billing(), plan())).toBe('CREATE');
		expect(
			planActionFor(
				billing({
					currentPlan: {
						merchantPricingPlanId: 'paid_old',
						planKind: 'PAID_METERED',
						cancelAtPeriodEnd: false,
					},
				}),
				plan()
			)
		).toBe('SWITCH');
		expect(
			planActionFor(
				billing({
					currentPlan: {
						merchantPricingPlanId: 'paid_1',
						planKind: 'PAID_METERED',
						cancelAtPeriodEnd: false,
					},
				}),
				plan()
			)
		).toBeNull();
		expect(
			planActionFor(billing({ experienceState: 'FROZEN' }), plan())
		).toBeNull();
		expect(
			planActionFor(
				billing({ pendingCancellation: { state: 'CONFIRMED' } }),
				plan()
			)
		).toBeNull();
	});

	it('uses browser UUID v4, submits a command once and redirects only after success', async () => {
		const pending = deferred();
		const client = {
			getBilling: vi.fn().mockResolvedValue(billing()),
			createSubscription: vi.fn(() => pending.promise),
		};
		const navigate = vi.fn();
		const controller = new BillingController(client, () => {}, navigate);
		controller.setActive(true);
		controller.setConnectionStatus('CONNECTED');
		await controller.billingPromise;
		const first = controller.createOrSwitch(plan());
		const second = controller.createOrSwitch(plan());
		await Promise.resolve();
		expect(client.createSubscription).toHaveBeenCalledTimes(1);
		const actionId = client.createSubscription.mock.calls[0][1];
		expect(actionId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		);
		expect(navigate).not.toHaveBeenCalled();
		pending.resolve({
			confirmationUrl: 'https://woocommerce.com/confirm/1',
		});
		await Promise.all([first, second]);
		expect(navigate).toHaveBeenCalledWith(
			'https://woocommerce.com/confirm/1'
		);
	});

	it('submits one eligible bundle once and redirects only to the accepted confirmation result', async () => {
		const pending = deferred();
		const client = {
			getBilling: vi
				.fn()
				.mockResolvedValue(billing({ topUps: topUps() })),
			purchaseRecoveryCredits: vi.fn(() => pending.promise),
		};
		const navigate = vi.fn();
		const controller = new BillingController(client, () => {}, navigate);
		controller.setActive(true);
		controller.setConnectionStatus('CONNECTED');
		await controller.billingPromise;
		const first = controller.purchaseRecoveryCredits('usage_bronze');
		const second = controller.purchaseRecoveryCredits('usage_silver');
		await Promise.resolve();
		expect(client.purchaseRecoveryCredits).toHaveBeenCalledTimes(1);
		expect(client.purchaseRecoveryCredits.mock.calls[0][0]).toBe(
			'usage_bronze'
		);
		expect(client.purchaseRecoveryCredits.mock.calls[0][1]).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		);
		expect(controller.state.command).toBe('SUBMITTING');
		pending.resolve({
			purchaseId: 'purchase_1',
			operationId: 'operation_1',
			state: 'AWAITING_CONFIRMATION',
			confirmationUrl: 'https://woocommerce.com/confirm/1',
		});
		await Promise.all([first, second]);
		expect(navigate).toHaveBeenCalledWith(
			'https://woocommerce.com/confirm/1'
		);
	});

	it('refreshes once after an unknown purchase outcome and never retries automatically', async () => {
		const unresolved = {
			merchantPricingUsageEventId: 'usage_bronze',
		};
		const client = {
			getBilling: vi
				.fn()
				.mockResolvedValueOnce(billing({ topUps: topUps() }))
				.mockResolvedValueOnce(
					billing({
						topUps: topUps({
							offers: [
								{
									...topUps().offers[0],
									purchaseEligible: false,
								},
								topUps().offers[1],
							],
							unresolvedPurchases: [unresolved],
						}),
					})
				),
			purchaseRecoveryCredits: vi
				.fn()
				.mockRejectedValue(
					new Error('billing_provider_outcome_unknown')
				),
		};
		const controller = new BillingController(client);
		controller.setActive(true);
		controller.setConnectionStatus('CONNECTED');
		await controller.billingPromise;
		await controller.purchaseRecoveryCredits('usage_bronze');
		expect(client.getBilling).toHaveBeenCalledTimes(2);
		expect(controller.state).toMatchObject({
			notice: 'billing_provider_outcome_unknown',
			blockedTopUpEventId: 'usage_bronze',
			status: 'READY',
		});
		await controller.purchaseRecoveryCredits('usage_bronze');
		expect(client.purchaseRecoveryCredits).toHaveBeenCalledTimes(1);
	});

	it('does not redirect after a top-up response arrives following disconnect', async () => {
		const pending = deferred();
		const client = {
			getBilling: vi
				.fn()
				.mockResolvedValue(billing({ topUps: topUps() })),
			purchaseRecoveryCredits: vi.fn(() => pending.promise),
		};
		const navigate = vi.fn();
		const controller = new BillingController(client, () => {}, navigate);
		controller.setActive(true);
		controller.setConnectionStatus('CONNECTED');
		await controller.billingPromise;
		const submission = controller.purchaseRecoveryCredits('usage_bronze');
		await Promise.resolve();
		controller.setConnectionStatus('DISCONNECTED');
		pending.resolve({
			purchaseId: 'purchase_1',
			operationId: 'operation_1',
			state: 'AWAITING_CONFIRMATION',
			confirmationUrl: 'https://woocommerce.com/confirm/1',
		});
		await submission;
		expect(navigate).not.toHaveBeenCalled();
		expect(controller.state).toMatchObject({ status: 'IDLE', data: null });
	});

	it('keeps the paid plan and performs one durable read after accepted cancellation', async () => {
		const current = billing({
			currentPlan: {
				merchantPricingPlanId: 'paid_1',
				planKind: 'PAID_METERED',
				cancelAtPeriodEnd: false,
			},
		});
		const refreshed = billing({
			currentPlan: current.currentPlan,
			pendingCancellation: { state: 'CONFIRMED' },
		});
		const client = {
			getBilling: vi
				.fn()
				.mockResolvedValueOnce(current)
				.mockResolvedValueOnce(refreshed),
			cancelSubscription: vi
				.fn()
				.mockResolvedValue({ state: 'CONFIRMED' }),
		};
		const controller = new BillingController(client);
		controller.setActive(true);
		controller.setConnectionStatus('CONNECTED');
		await controller.billingPromise;
		await controller.cancel();
		expect(client.getBilling).toHaveBeenCalledTimes(2);
		expect(controller.state.data.currentPlan.planKind).toBe('PAID_METERED');
		expect(controller.state.data.pendingCancellation.state).toBe(
			'CONFIRMED'
		);
		expect(controller.state.notice).toBe('CANCEL_ACCEPTED');
	});

	it('treats the Woo return marker as a bounded boolean signal', () => {
		expect(isBillingReturn('?moda_billing_return=1&operation=opaque')).toBe(
			true
		);
		expect(isBillingReturn('?moda_billing_return=2')).toBe(false);
		expect(
			createBillingActionId({
				randomUUID: () => '550e8400-e29b-41d4-a716-446655440000',
			})
		).toBe('550e8400-e29b-41d4-a716-446655440000');
	});
});
