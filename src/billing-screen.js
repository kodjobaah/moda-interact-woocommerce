import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { planActionFor } from './billing-controller';

function formatMoney(amountMinor, currency) {
	try {
		const formatter = new Intl.NumberFormat(undefined, {
			style: 'currency',
			currency,
		});
		const fractionDigits =
			formatter.resolvedOptions().maximumFractionDigits;
		return formatter.format(amountMinor / 10 ** fractionDigits);
	} catch {
		return `${amountMinor} ${currency}`;
	}
}

function formatDate(value) {
	if (!value) {
		return __('Not applicable', 'moda-interact');
	}
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeZone: 'UTC',
	}).format(new Date(value));
}

function planStateLabel(state) {
	const labels = {
		INITIATING: __('Starting the plan change', 'moda-interact'),
		AWAITING_CONFIRMATION: __(
			'Waiting for Woo confirmation',
			'moda-interact'
		),
		OUTCOME_UNKNOWN: __(
			'The plan change needs reconciliation. Do not retry it automatically.',
			'moda-interact'
		),
	};
	return labels[state] ?? __('Plan status unavailable', 'moda-interact');
}

function cancellationStateLabel(state) {
	const labels = {
		INITIATING: __('Starting the cancellation request', 'moda-interact'),
		AWAITING_CONFIRMATION: __(
			'Waiting for Woo cancellation confirmation',
			'moda-interact'
		),
		OUTCOME_UNKNOWN: __(
			'The cancellation needs reconciliation. Do not retry it automatically.',
			'moda-interact'
		),
		CONFIRMED: __(
			'Woo accepted the request. Moda is waiting for verified cancellation details.',
			'moda-interact'
		),
	};
	return (
		labels[state] ?? __('Cancellation status unavailable', 'moda-interact')
	);
}

function dataRow(label, value, key = label) {
	return [
		createElement('dt', { key: `${key}-label` }, label),
		createElement('dd', { key: `${key}-value` }, value),
	];
}

function SummaryCard({ title, children }) {
	return createElement(
		'section',
		{ className: 'moda-interact-billing-card' },
		createElement('h3', null, title),
		children
	);
}

function BillingSummary({ data, state, onCancel }) {
	const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
	const keepPlanRef = useRef(null);
	const dialogCancelRef = useRef(null);
	const cancelTriggerRef = useRef(null);
	const dialogWasOpen = useRef(false);
	useEffect(() => {
		if (cancelDialogOpen) {
			keepPlanRef.current?.focus();
		} else if (dialogWasOpen.current && cancelTriggerRef.current) {
			cancelTriggerRef.current.focus();
		}
		dialogWasOpen.current = cancelDialogOpen;
	}, [cancelDialogOpen]);

	return createElement(BillingSummaryView, {
		data,
		state,
		onCancel,
		cancelDialogOpen,
		setCancelDialogOpen,
		keepPlanRef,
		dialogCancelRef,
		cancelTriggerRef,
	});
}

function BillingSummaryView({
	data,
	state,
	onCancel,
	cancelDialogOpen,
	setCancelDialogOpen,
	keepPlanRef,
	dialogCancelRef,
	cancelTriggerRef,
}) {
	const currentPlan = data.currentPlan;
	const frozen = data.experienceState === 'FROZEN';
	const attention = data.experienceState === 'BILLING_ATTENTION';
	const unsupported = data.experienceState === 'NO_CONTRACT';
	const paid = currentPlan?.planKind === 'PAID_METERED';
	const canCancel =
		data.surfaces.cancelSubscriptionAllowed &&
		paid &&
		!data.pendingPlan &&
		!data.pendingCancellation &&
		!currentPlan?.cancelAtPeriodEnd &&
		['ACTIVE', 'FROZEN'].includes(data.experienceState) &&
		state.command === null;
	const amount = currentPlan
		? formatMoney(currentPlan.recurringAmountMinor, currentPlan.currency)
		: __('Not available', 'moda-interact');
	const periodEnd = currentPlan
		? formatDate(currentPlan.currentPeriodEnd)
		: __('Not available', 'moda-interact');

	return createElement(
		'div',
		{ className: 'moda-interact-billing-summary' },
		frozen
			? createElement(
					'p',
					{
						className: 'moda-interact-billing-notice',
						role: 'status',
					},
					__(
						'Recurring billing recovery is required.',
						'moda-interact'
					),
					' ',
					__(
						'Paid included credits are temporarily unavailable. Purchased credits and remaining lifetime Free credits remain usable; promotional credits follow their existing eligibility.',
						'moda-interact'
					)
				)
			: null,
		attention
			? createElement(
					'p',
					{
						className: 'moda-interact-billing-notice',
						role: 'status',
					},
					__(
						'Billing needs attention. Plan changes are unavailable while Moda verifies billing status.',
						'moda-interact'
					)
				)
			: null,
		unsupported
			? createElement(
					'p',
					{
						className: 'moda-interact-billing-notice',
						role: 'status',
					},
					__(
						'No recurring billing contract is available for this store.',
						'moda-interact'
					)
				)
			: null,
		state.notice === 'CANCEL_ACCEPTED'
			? createElement(
					'p',
					{
						className: 'moda-interact-billing-success',
						role: 'status',
					},
					__('Cancellation request accepted.', 'moda-interact')
				)
			: null,
		state.data.pendingPlan
			? createElement(
					'p',
					{
						className: 'moda-interact-billing-notice',
						role: 'status',
					},
					sprintf(
						/* translators: 1: plan name, 2: pending plan operation state. */
						__('%1$s: %2$s', 'moda-interact'),
						state.data.pendingPlan.displayName,
						planStateLabel(state.data.pendingPlan.state)
					)
				)
			: null,
		state.data.pendingCancellation
			? createElement(
					'p',
					{
						className: 'moda-interact-billing-notice',
						role: 'status',
					},
					cancellationStateLabel(state.data.pendingCancellation.state)
				)
			: null,
		createElement(
			'div',
			{ className: 'moda-interact-billing-grid' },
			createElement(
				SummaryCard,
				{ title: __('Current plan', 'moda-interact') },
				currentPlan
					? createElement(
							'dl',
							{ className: 'moda-interact-details' },
							...dataRow(
								__('Plan', 'moda-interact'),
								currentPlan.displayName
							),
							...dataRow(
								__('Plan type', 'moda-interact'),
								currentPlan.planKind === 'FREE'
									? __('Free', 'moda-interact')
									: __('Paid recurring', 'moda-interact')
							),
							...dataRow(
								__('Recurring amount', 'moda-interact'),
								currentPlan.planKind === 'FREE'
									? __('No recurring charge', 'moda-interact')
									: amount
							),
							...dataRow(
								__('Billing period', 'moda-interact'),
								__('Every 30 days', 'moda-interact')
							),
							...dataRow(
								__(
									'Next included allowance reset',
									'moda-interact'
								),
								periodEnd
							),
							...(currentPlan.cancelAtPeriodEnd
								? dataRow(
										__(
											'Paid subscription ends',
											'moda-interact'
										),
										formatDate(
											currentPlan.cancellationEffectiveAt
										),
										'cancellation-effective'
									)
								: []),
							...(currentPlan.cancelAtPeriodEnd
								? dataRow(
										__(
											'Subscription status',
											'moda-interact'
										),
										__('Scheduled to end', 'moda-interact')
									)
								: [])
						)
					: createElement(
							'p',
							{ role: 'status' },
							__(
								'No current plan details are available.',
								'moda-interact'
							)
						),
				canCancel
					? createElement(
							'button',
							{
								type: 'button',
								className: 'button',
								ref: cancelTriggerRef,
								disabled: state.command !== null,
								'aria-busy': state.command === 'SUBMITTING',
								onClick: () => setCancelDialogOpen(true),
							},
							state.command === 'SUBMITTING'
								? __(
										'Submitting cancellation…',
										'moda-interact'
									)
								: __('Cancel subscription', 'moda-interact')
						)
					: null,
				cancelDialogOpen
					? createElement(
							'div',
							{
								className: 'moda-interact-cancel-dialog',
								role: 'alertdialog',
								'aria-modal': 'true',
								'aria-labelledby': 'moda-interact-cancel-title',
								'aria-describedby':
									'moda-interact-cancel-description',
								onKeyDown: (event) => {
									if (event.key === 'Escape') {
										event.preventDefault();
										setCancelDialogOpen(false);
									}
									if (
										event.key === 'Tab' &&
										!event.shiftKey
									) {
										event.preventDefault();
										dialogCancelRef.current?.focus();
									}
									if (event.key === 'Tab' && event.shiftKey) {
										event.preventDefault();
										keepPlanRef.current?.focus();
									}
								},
							},
							createElement(
								'h3',
								{ id: 'moda-interact-cancel-title' },
								__('Cancel recurring plan?', 'moda-interact')
							),
							createElement(
								'p',
								{ id: 'moda-interact-cancel-description' },
								__(
									'Paid access remains available until cancellation is verified and the prepaid term ends. This request does not immediately change your current plan.',
									'moda-interact'
								)
							),
							createElement(
								'div',
								{
									className:
										'moda-interact-cancel-dialog__actions',
								},
								createElement(
									'button',
									{
										type: 'button',
										className: 'button',
										ref: keepPlanRef,
										onClick: () =>
											setCancelDialogOpen(false),
									},
									__('Keep current plan', 'moda-interact')
								),
								createElement(
									'button',
									{
										type: 'button',
										className: 'button button-primary',
										ref: dialogCancelRef,
										disabled: state.command !== null,
										'aria-busy':
											state.command === 'SUBMITTING',
										onClick: () => {
											setCancelDialogOpen(false);
											onCancel();
										},
									},
									state.command === 'SUBMITTING'
										? __('Submitting…', 'moda-interact')
										: __(
												'Confirm cancellation',
												'moda-interact'
											)
								)
							)
						)
					: null
			),
			createElement(
				SummaryCard,
				{ title: __('Recovery capacity', 'moda-interact') },
				createElement(
					'dl',
					{ className: 'moda-interact-details' },
					...(data.capacity.paidIncluded
						? dataRow(
								__(
									'Paid included credits remaining',
									'moda-interact'
								),
								frozen
									? __(
											'Temporarily unavailable',
											'moda-interact'
										)
									: String(
											data.capacity.paidIncluded.remaining
										)
							)
						: []),
					...dataRow(
						__('Lifetime Free credits remaining', 'moda-interact'),
						String(data.capacity.freeLifetime.remaining)
					),
					...dataRow(
						__('Promotional credits remaining', 'moda-interact'),
						String(data.capacity.promotional.remaining)
					),
					...dataRow(
						__('Purchased credits available', 'moda-interact'),
						String(data.capacity.purchased.available)
					)
				)
			)
		)
	);
}

function PlanCard({ plan, data, state, onSelect }) {
	const action = planActionFor(data, plan);
	const isCurrent =
		data.currentPlan?.merchantPricingPlanId === plan.merchantPricingPlanId;
	const transitionPending = Boolean(
		data.pendingPlan ||
		data.pendingCancellation ||
		data.currentPlan?.cancelAtPeriodEnd
	);
	const disabled = !action || state.command !== null;
	let actionLabel = __('Unavailable', 'moda-interact');
	if (isCurrent) {
		actionLabel = __('Current plan', 'moda-interact');
	} else if (transitionPending) {
		actionLabel = __('Billing change in progress', 'moda-interact');
	} else if (state.command === 'SUBMITTING') {
		actionLabel = __('Submitting…', 'moda-interact');
	} else if (action === 'CREATE') {
		actionLabel = __('Choose plan', 'moda-interact');
	} else if (action === 'SWITCH') {
		actionLabel = __('Switch to plan', 'moda-interact');
	}

	return createElement(
		'article',
		{
			className: `moda-interact-plan${plan.featured ? ' moda-interact-plan--featured' : ''}`,
			key: plan.merchantPricingPlanId,
		},
		plan.featured
			? createElement(
					'p',
					{ className: 'moda-interact-plan__featured' },
					__('Featured', 'moda-interact')
				)
			: null,
		createElement('h3', null, plan.displayName),
		createElement('p', null, plan.localizedDescription),
		createElement(
			'p',
			{ className: 'moda-interact-plan__price' },
			plan.planKind === 'FREE'
				? __('Free', 'moda-interact')
				: sprintf(
						/* translators: 1: recurring plan price. */
						__('%1$s / every 30 days', 'moda-interact'),
						formatMoney(plan.recurringAmountMinor, plan.currency)
					)
		),
		createElement(
			'p',
			null,
			plan.allowancePeriod === 'LIFETIME'
				? __('Lifetime recovery credits', 'moda-interact')
				: __('Recovery credits every 30 days', 'moda-interact'),
			': ',
			String(plan.includedRecoveryCredits)
		),
		plan.highlights.length
			? createElement(
					'ul',
					null,
					...plan.highlights.map((highlight) =>
						createElement(
							'li',
							{ key: highlight.contentKey },
							createElement('strong', null, highlight.title),
							' ',
							highlight.description
						)
					)
				)
			: null,
		createElement(
			'button',
			{
				type: 'button',
				className: 'button button-primary',
				disabled,
				'aria-busy': state.command === 'SUBMITTING',
				onClick: () => onSelect(plan),
			},
			actionLabel
		)
	);
}

function PlansView({ state, onSelect, onRetry }) {
	if (!state.data.surfaces.managePlansAllowed) {
		return createElement(
			'p',
			{ className: 'moda-interact-message', role: 'status' },
			__(
				'Plan management is unavailable for the current billing state.',
				'moda-interact'
			)
		);
	}
	if (state.plansStatus === 'IDLE' || state.plansStatus === 'LOADING') {
		return createElement(
			'p',
			{ className: 'moda-interact-message', role: 'status' },
			__('Loading available plans…', 'moda-interact')
		);
	}
	if (state.plansStatus !== 'READY') {
		return createElement(
			'div',
			{ className: 'moda-interact-state' },
			createElement(
				'p',
				{ className: 'moda-interact-message', role: 'alert' },
				__('The plan catalogue could not be loaded.', 'moda-interact')
			),
			createElement(
				'button',
				{ type: 'button', className: 'button', onClick: onRetry },
				__('Retry plan catalogue', 'moda-interact')
			)
		);
	}
	return createElement(
		'div',
		{ className: 'moda-interact-plan-grid' },
		...state.plans.plans.map((plan) =>
			createElement(PlanCard, {
				key: plan.merchantPricingPlanId,
				plan,
				data: state.data,
				state,
				onSelect,
			})
		)
	);
}

function billingError(error) {
	const messages = {
		remote_unavailable: __(
			'Billing is temporarily unavailable. Your current billing state has not changed.',
			'moda-interact'
		),
		remote_response_invalid: __(
			'Billing data could not be verified. Try again later.',
			'moda-interact'
		),
		billing_not_initialized: __(
			'Billing setup is not complete for this store.',
			'moda-interact'
		),
		billing_operation_conflict: __(
			'A billing change is already in progress. Refresh the billing summary before trying again.',
			'moda-interact'
		),
		billing_operation_in_progress: __(
			'A billing change is already in progress. Refresh the billing summary before trying again.',
			'moda-interact'
		),
		billing_provider_outcome_unknown: __(
			'The provider result is not yet known. Refresh the billing summary or contact support; do not retry automatically.',
			'moda-interact'
		),
		billing_operation_failed: __(
			'The billing change could not be completed. Your current plan remains unchanged.',
			'moda-interact'
		),
		invalid_plan_selection: __(
			'This plan is no longer available. Refresh the plan catalogue.',
			'moda-interact'
		),
	};
	return (
		messages[error] ??
		__('The billing request failed. Try again.', 'moda-interact')
	);
}

export function BillingScreen({
	state,
	onRefresh,
	onLoadPlans,
	onSelectPlan,
	onCancel,
	onSetView,
}) {
	let content;
	if (state.status === 'IDLE' || state.status === 'LOADING') {
		content = createElement(
			'p',
			{ className: 'moda-interact-message', role: 'status' },
			__('Loading billing summary…', 'moda-interact')
		);
	} else if (state.status === 'REMOTE_UNAVAILABLE') {
		content = createElement(
			'p',
			{ className: 'moda-interact-message', role: 'alert' },
			billingError(state.error)
		);
	} else if (state.status === 'RECONNECT_REQUIRED') {
		content = createElement(
			'p',
			{ className: 'moda-interact-message', role: 'alert' },
			__(
				'The Moda Interact connection needs attention before billing can be loaded.',
				'moda-interact'
			)
		);
	} else if (state.status !== 'READY') {
		content = createElement(
			'div',
			{ className: 'moda-interact-state' },
			createElement(
				'p',
				{ className: 'moda-interact-message', role: 'alert' },
				billingError(state.error)
			),
			createElement(
				'button',
				{ type: 'button', className: 'button', onClick: onRefresh },
				__('Refresh billing', 'moda-interact')
			)
		);
	} else if (state.view === 'PLANS') {
		content = createElement(PlansView, {
			state,
			onSelect: onSelectPlan,
			onRetry: onLoadPlans,
		});
	} else {
		content = createElement(BillingSummary, {
			data: state.data,
			state,
			onCancel,
		});
	}

	return createElement(
		'section',
		{
			className: 'moda-interact-billing',
			'aria-labelledby': 'moda-interact-billing-heading',
			'aria-busy':
				state.status === 'LOADING' ||
				state.plansStatus === 'LOADING' ||
				state.command === 'SUBMITTING',
		},
		createElement(
			'div',
			{ className: 'moda-interact-billing__heading' },
			createElement(
				'h2',
				{ id: 'moda-interact-billing-heading' },
				__('Billing', 'moda-interact')
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: state.status === 'LOADING',
					onClick: onRefresh,
				},
				__('Refresh billing', 'moda-interact')
			)
		),
		state.error
			? createElement(
					'p',
					{
						className: 'moda-interact-message--error',
						role: 'alert',
					},
					billingError(state.error)
				)
			: null,
		createElement(
			'div',
			{ className: 'moda-interact-billing__tabs', role: 'tablist' },
			...[
				['SUMMARY', __('Summary', 'moda-interact')],
				['PLANS', __('Plans', 'moda-interact')],
			].map(([view, label]) =>
				createElement(
					'button',
					{
						type: 'button',
						role: 'tab',
						'aria-selected': state.view === view,
						className:
							state.view === view
								? 'button moda-interact-billing__tab is-active'
								: 'button moda-interact-billing__tab',
						disabled:
							view === 'PLANS' &&
							state.status === 'READY' &&
							!state.data.surfaces.managePlansAllowed,
						onClick: () => onSetView(view),
					},
					label
				)
			)
		),
		content
	);
}

export {
	BillingSummary,
	BillingSummaryView,
	PlanCard,
	formatDate,
	formatMoney,
};
