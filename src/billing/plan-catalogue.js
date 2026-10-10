import { createElement } from '@wordpress/element';
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
			className: `moda-interact-plan${plan.featured ? ' moda-interact-plan--featured' : ''}${isCurrent ? ' moda-interact-plan--current' : ''}`,
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
		createElement(
			'p',
			{ className: 'moda-interact-plan__description' },
			plan.localizedDescription
		),
		createElement(
			'p',
			{ className: 'moda-interact-plan__price' },
			plan.planKind === 'FREE'
				? __('Free', 'moda-interact')
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

export function PlansView({
	state,
	onSelect,
	onRetry,
	locale = resolveBillingLocale(),
}) {
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
				locale,
			})
		)
	);
}
