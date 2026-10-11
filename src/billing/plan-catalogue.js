import { createElement, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { planActionFor } from '../billing-controller';
import {
	formatMoney,
	formatQuantity,
	resolveBillingLocale,
} from './presentation-formatters';

export function PlanCard({
	plan,
	data,
	state,
	onSelect,
	actionRef,
	locale = resolveBillingLocale(),
}) {
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
	if (transitionPending) {
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
			className: `moda-interact-plan${plan.featured ? ' moda-interact-plan--featured' : ''}${isCurrent ? ' moda-interact-plan--current' : ''}`,
			key: plan.merchantPricingPlanId,
		},
		createElement(
			'div',
			{ className: 'moda-interact-plan__header' },
			createElement(
				'div',
				{ className: 'moda-interact-plan__badges' },
				isCurrent
					? createElement(
						'span',
						{ className: 'moda-interact-plan__current-badge' },
						__('Current plan', 'moda-interact')
					)
					: null,
				plan.featured
					? createElement(
						'span',
						{ className: 'moda-interact-plan__featured' },
						__('Featured', 'moda-interact')
					)
					: null
			),
			isCurrent
				? createElement(
					'span',
					{ className: 'moda-interact-plan__current-mark', 'aria-hidden': 'true' },
					'✓'
				)
				: null
		),
		createElement('h4', null, plan.displayName),
		createElement(
			'p',
			{ className: 'moda-interact-plan__price' },
			plan.planKind === 'FREE'
				? formatMoney(0, plan.currency, locale)
				: sprintf(
						/* translators: 1: recurring plan price. */ __(
							'%1$s / every 30 days',
							'moda-interact'
						),
						formatMoney(
							plan.recurringAmountMinor,
							plan.currency,
							locale
						)
					)
		),
		plan.planKind === 'FREE'
			? createElement(
					'p',
					{ className: 'moda-interact-plan__period' },
					__('No recurring charge', 'moda-interact')
				)
			: null,
		createElement(
			'p',
			{ className: 'moda-interact-plan__description' },
			plan.localizedDescription
		),
		createElement(
			'p',
			{ className: 'moda-interact-plan__allowance' },
			plan.allowancePeriod === 'LIFETIME'
				? __('Lifetime recovery credits', 'moda-interact')
				: __('Recovery credits every 30 days', 'moda-interact'),
			': ',
			formatQuantity(plan.includedRecoveryCredits, locale)
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
		// The current plan is identified by its badge; do not render a dead CTA.
		isCurrent
			? null
			: createElement(
					'button',
					{
						type: 'button',
						className: 'button button-primary',
						disabled,
						'aria-busy': state.command === 'SUBMITTING',
						ref: actionRef,
						onClick: () => onSelect(plan),
					},
					actionLabel
				)
	);
}

export function PlansView({
	state,
	onSelect,
	onRetry,
	locale = resolveBillingLocale(),
}) {
	const nextPlanActionRef = useRef(null);
	const [noAlternatives, setNoAlternatives] = useState(false);
	const canManagePlans = state.data.surfaces.managePlansAllowed;
	const firstActionablePlanId =
		canManagePlans && state.plansStatus === 'READY'
			? state.plans?.plans.find((plan) => planActionFor(state.data, plan))
					?.merchantPricingPlanId
			: null;

	function focusPlanChoice() {
		const choice = nextPlanActionRef.current;
		if (!choice || choice.disabled) {
			setNoAlternatives(true);
			return;
		}
		setNoAlternatives(false);
		choice.scrollIntoView?.({ block: 'nearest' });
		choice.focus();
	}

	let content;
	if (!state.data.surfaces.managePlansAllowed) {
		content = createElement(
			'p',
			{ className: 'moda-interact-message', role: 'status' },
			__(
				'Plan management is unavailable for the current billing state.',
				'moda-interact'
			)
		);
	} else if (state.plansStatus === 'IDLE' || state.plansStatus === 'LOADING') {
		content = createElement(
			'p',
			{ className: 'moda-interact-message', role: 'status' },
			__('Loading available plans…', 'moda-interact')
		);
	} else if (state.plansStatus !== 'READY') {
		content = createElement(
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
	} else {
		content = createElement(
			'div',
			{ className: 'moda-interact-plan-grid' },
			...state.plans.plans.map((plan) =>
				createElement(PlanCard, {
					key: plan.merchantPricingPlanId,
					plan,
					data: state.data,
					state,
					onSelect,
					actionRef: plan.merchantPricingPlanId === firstActionablePlanId
						? nextPlanActionRef
						: undefined,
					locale,
				})
			)
		);
	}

	return createElement(
		'section',
		{
			className: 'moda-interact-plan-section',
			'aria-labelledby': 'moda-interact-plan-section-heading',
		},
		createElement(
			'header',
			{ className: 'moda-interact-plan-section__intro' },
			createElement(
				'p',
				{ className: 'moda-interact-plan-section__eyebrow' },
				__('Subscription plans', 'moda-interact')
			),
			createElement(
				'h3',
				{ id: 'moda-interact-plan-section-heading' },
				__('Choose the plan that fits your recovery volume', 'moda-interact')
			),
			createElement(
				'p',
				{ className: 'moda-interact-plan-section__description' },
				__('Plan changes are confirmed through WooCommerce billing.', 'moda-interact')
			)
		),
		content,
		// Shopify uses a separate Manage Plans route. Woo focuses the existing
		// eligible catalogue action instead, never submitting a provider command.
		canManagePlans && state.plansStatus === 'READY' && state.data.currentPlan
			? createElement(
				'div',
				{ className: 'moda-interact-plan-section__actions' },
				createElement(
					'button',
					{
						type: 'button',
						className: 'moda-interact-plan-section__manage-button',
						disabled: state.command !== null,
						onClick: focusPlanChoice,
					},
					__('Change plan', 'moda-interact')
				),
				noAlternatives
					? createElement(
						'p',
						{ className: 'moda-interact-plan-section__no-alternatives', role: 'status' },
						__('No other plans are currently available.', 'moda-interact')
					)
					: null
			)
			: null
	);
}
