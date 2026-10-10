import { createBillingClient } from './billing-client';

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isBillingReturn(search = '') {
	return new URLSearchParams(search).get('moda_billing_return') === '1';
}

export function createBillingActionId(cryptoObject = globalThis.crypto) {
	if (!cryptoObject || typeof cryptoObject.randomUUID !== 'function') {
		throw new Error('secure_random_unavailable');
	}
	const actionId = cryptoObject.randomUUID();
	if (typeof actionId !== 'string' || !UUID_V4_PATTERN.test(actionId)) {
		throw new Error('secure_random_unavailable');
	}
	return actionId;
}

export function planActionFor(data, plan) {
	if (
		!data ||
		!plan ||
		!data.surfaces.managePlansAllowed ||
		data.experienceState !== 'ACTIVE' ||
		data.pendingPlan ||
		data.pendingCancellation ||
		data.currentPlan?.cancelAtPeriodEnd
	) {
		return null;
	}
	if (
		data.currentPlan?.planKind === 'FREE' &&
		plan.planKind === 'PAID_METERED'
	) {
		return 'CREATE';
	}
	if (
		data.currentPlan?.planKind === 'PAID_METERED' &&
		plan.planKind === 'PAID_METERED' &&
		plan.merchantPricingPlanId !== data.currentPlan.merchantPricingPlanId
	) {
		return 'SWITCH';
	}
	return null;
}

export function canPurchaseRecoveryCredits(data, usageEventId) {
	if (
		!data?.topUps?.configured ||
		!data.topUps.purchaseEligible ||
		typeof usageEventId !== 'string'
	) {
		return false;
	}
	const offer = data.topUps.offers.find(
		(entry) => entry.merchantPricingUsageEventId === usageEventId
	);
	return Boolean(
		offer?.purchaseEligible &&
		!data.topUps.unresolvedPurchases.some(
			(purchase) => purchase.merchantPricingUsageEventId === usageEventId
		)
	);
}

function initialState() {
	return {
		status: 'IDLE',
		data: null,
		plansStatus: 'IDLE',
		plans: null,
		view: 'SUMMARY',
		command: null,
		notice: null,
		blockedTopUpEventId: null,
		error: null,
	};
}

export class BillingController {
	constructor(
		client = createBillingClient(),
		onConnectionAttention = () => {},
		navigate = (url) => globalThis.location.assign(url)
	) {
		this.client = client;
		this.onConnectionAttention = onConnectionAttention;
		this.navigate = navigate;
		this.listeners = new Set();
		this.connectionStatus = 'LOADING';
		this.active = false;
		this.billingRevision = 0;
		this.plansRevision = 0;
		this.connectionRevision = 0;
		this.billingPromise = null;
		this.plansPromise = null;
		this.commandPromise = null;
		this.disposed = false;
		this.state = initialState();
	}

	subscribe(listener) {
		if (this.disposed) {
			return () => {};
		}
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	setConnectionStatus(status) {
		if (this.disposed || status === this.connectionStatus) {
			return;
		}
		this.connectionStatus = status;
		this.connectionRevision += 1;
		this.billingRevision += 1;
		this.plansRevision += 1;
		if (status !== 'CONNECTED') {
			this.publish(initialState());
			return;
		}
		if (this.active) {
			this.refresh();
		}
	}

	setActive(active) {
		if (this.disposed || active === this.active) {
			return Promise.resolve(this.state);
		}
		this.active = active;
		if (!active) {
			this.billingRevision += 1;
			this.plansRevision += 1;
			this.billingPromise = null;
			this.plansPromise = null;
			return Promise.resolve(this.state);
		}
		return this.refresh();
	}

	setView(view) {
		if (!['SUMMARY', 'PLANS'].includes(view) || this.disposed) {
			return Promise.resolve(this.state);
		}
		this.publish({ ...this.state, view });
		if (
			view === 'PLANS' &&
			this.connectionStatus === 'CONNECTED' &&
			this.state.status === 'READY' &&
			this.state.data.surfaces.managePlansAllowed
		) {
			return this.loadPlans();
		}
		return Promise.resolve(this.state);
	}

	refresh(afterCommand = false) {
		if (
			this.disposed ||
			!this.active ||
			this.connectionStatus !== 'CONNECTED'
		) {
			return Promise.resolve(this.state);
		}
		if (this.commandPromise && !afterCommand) {
			return this.commandPromise.then(() => this.refresh());
		}
		if (this.billingPromise) {
			return this.billingPromise;
		}

		const revision = ++this.billingRevision;
		const connectionRevision = this.connectionRevision;
		this.publish({
			...this.state,
			status: 'LOADING',
			error: null,
			...(afterCommand
				? {}
				: { notice: null, blockedTopUpEventId: null }),
		});
		const operation = this.client
			.getBilling()
			.then((data) => {
				if (this.isCurrentBilling(revision, connectionRevision)) {
					this.publish({
						...this.state,
						status: 'READY',
						data,
						error: null,
					});
					if (
						this.state.view === 'PLANS' &&
						data.surfaces.managePlansAllowed
					) {
						this.loadPlans();
					}
				}
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrentBilling(revision, connectionRevision)) {
					const code = error?.message;
					if (
						code === 'RECONNECT_REQUIRED' ||
						code === 'remote_authentication_failed'
					) {
						this.publish({
							...this.state,
							status: 'RECONNECT_REQUIRED',
							data: null,
							error: code,
						});
						this.onConnectionAttention();
					} else if (code === 'remote_unavailable') {
						this.publish({
							...this.state,
							status: 'REMOTE_UNAVAILABLE',
							data: null,
							error: code,
						});
					} else {
						this.publish({
							...this.state,
							status: 'LOAD_FAILED',
							data: null,
							error: code ?? 'LOAD_FAILED',
						});
						if (
							code === 'SITE_URL_CHANGED' ||
							code === 'LOCAL_STATE_INVALID'
						) {
							this.onConnectionAttention();
						}
					}
				}
				return this.state;
			});
		const request = operation.finally(() => {
			if (this.billingPromise === request) {
				this.billingPromise = null;
			}
		});
		this.billingPromise = request;
		return request;
	}

	loadPlans() {
		if (
			this.disposed ||
			!this.active ||
			this.connectionStatus !== 'CONNECTED' ||
			this.state.status !== 'READY' ||
			!this.state.data.surfaces.managePlansAllowed
		) {
			return Promise.resolve(this.state);
		}
		if (this.plansPromise) {
			return this.plansPromise;
		}
		const revision = ++this.plansRevision;
		const connectionRevision = this.connectionRevision;
		this.publish({ ...this.state, plansStatus: 'LOADING' });
		const operation = this.client
			.getPlans()
			.then((plans) => {
				if (this.isCurrentPlans(revision, connectionRevision)) {
					this.publish({
						...this.state,
						plansStatus: 'READY',
						plans,
					});
				}
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrentPlans(revision, connectionRevision)) {
					this.publish({
						...this.state,
						plansStatus: 'LOAD_FAILED',
						error: error?.message ?? 'LOAD_FAILED',
					});
				}
				return this.state;
			});
		const request = operation.finally(() => {
			if (this.plansPromise === request) {
				this.plansPromise = null;
			}
		});
		this.plansPromise = request;
		return request;
	}

	createOrSwitch(plan) {
		const action = planActionFor(this.state.data, plan);
		if (!action || this.state.status !== 'READY') {
			return Promise.resolve(this.state);
		}
		const method =
			action === 'CREATE' ? 'createSubscription' : 'switchSubscription';
		return this.submitCommand(() =>
			this.client[method](
				plan.merchantPricingPlanId,
				createBillingActionId()
			)
		);
	}

	purchaseRecoveryCredits(usageEventId) {
		if (
			this.state.status !== 'READY' ||
			!canPurchaseRecoveryCredits(this.state.data, usageEventId) ||
			this.state.blockedTopUpEventId === usageEventId
		) {
			return Promise.resolve(this.state);
		}
		return this.submitCommand(
			() =>
				this.client.purchaseRecoveryCredits(
					usageEventId,
					createBillingActionId()
				),
			false,
			{
				refreshErrors: new Set([
					'top_up_purchase_pending',
					'billing_provider_outcome_unknown',
					'billing_operation_in_progress',
					'top_up_bundle_not_found',
					'top_up_purchase_unavailable',
				]),
				usageEventId,
			}
		);
	}

	cancel() {
		const data = this.state.data;
		if (
			this.state.status !== 'READY' ||
			!data?.surfaces.cancelSubscriptionAllowed ||
			!['ACTIVE', 'FROZEN'].includes(data.experienceState) ||
			data.currentPlan?.planKind !== 'PAID_METERED' ||
			data.pendingPlan ||
			data.pendingCancellation ||
			data.currentPlan.cancelAtPeriodEnd
		) {
			return Promise.resolve(this.state);
		}
		return this.submitCommand(
			() => this.client.cancelSubscription(createBillingActionId()),
			true
		);
	}

	submitCommand(command, cancellation = false, options = {}) {
		if (
			this.disposed ||
			!this.active ||
			this.connectionStatus !== 'CONNECTED' ||
			this.commandPromise
		) {
			return this.commandPromise ?? Promise.resolve(this.state);
		}
		const connectionRevision = this.connectionRevision;
		this.billingRevision += 1;
		this.publish({
			...this.state,
			command: 'SUBMITTING',
			notice: null,
			error: null,
		});
		const operation = Promise.resolve()
			.then(command)
			.then((result) => {
				if (!this.isCurrentConnection(connectionRevision)) {
					return this.state;
				}
				if (cancellation) {
					this.publish({
						...this.state,
						command: null,
						notice: 'CANCEL_ACCEPTED',
					});
					return this.refreshAfterCommand();
				}
				this.publish({ ...this.state, command: 'REDIRECTING' });
				this.navigate(result.confirmationUrl);
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrentConnection(connectionRevision)) {
					const code = error?.message ?? 'remote_unavailable';
					const refresh = options.refreshErrors?.has(code) ?? false;
					this.publish({
						...this.state,
						command: null,
						notice: refresh ? code : null,
						blockedTopUpEventId:
							options.usageEventId &&
							[
								'top_up_purchase_pending',
								'billing_provider_outcome_unknown',
								'billing_operation_in_progress',
								'top_up_bundle_not_found',
								'idempotency_conflict',
							].includes(code)
								? options.usageEventId
								: this.state.blockedTopUpEventId,
						error: refresh ? null : code,
					});
					if (refresh) {
						return this.refreshAfterCommand().then(() => {
							if (this.isCurrentConnection(connectionRevision)) {
								this.publish({ ...this.state, notice: code });
							}
							return this.state;
						});
					}
					if (
						code === 'RECONNECT_REQUIRED' ||
						code === 'remote_authentication_failed'
					) {
						this.onConnectionAttention();
					}
				}
				return this.state;
			})
			.finally(() => {
				if (this.commandPromise === operation) {
					this.commandPromise = null;
				}
			});
		this.commandPromise = operation;
		return operation;
	}

	async refreshAfterCommand() {
		if (this.billingPromise) {
			await this.billingPromise;
		}
		if (this.connectionStatus !== 'CONNECTED' || this.disposed) {
			return this.state;
		}
		return this.refresh(true);
	}

	dispose() {
		this.disposed = true;
		this.billingRevision += 1;
		this.plansRevision += 1;
		this.connectionRevision += 1;
		this.listeners.clear();
	}

	isCurrentBilling(revision, connectionRevision) {
		return (
			!this.disposed &&
			this.active &&
			this.connectionStatus === 'CONNECTED' &&
			connectionRevision === this.connectionRevision &&
			revision === this.billingRevision
		);
	}

	isCurrentPlans(revision, connectionRevision) {
		return (
			!this.disposed &&
			this.active &&
			this.connectionStatus === 'CONNECTED' &&
			connectionRevision === this.connectionRevision &&
			revision === this.plansRevision &&
			this.state.status === 'READY' &&
			this.state.data.surfaces.managePlansAllowed
		);
	}

	isCurrentConnection(revision) {
		return (
			!this.disposed &&
			this.active &&
			this.connectionStatus === 'CONNECTED' &&
			revision === this.connectionRevision
		);
	}

	publish(state) {
		if (this.disposed) {
			return;
		}
		this.state = state;
		for (const listener of this.listeners) {
			listener(this.state);
		}
	}
}
