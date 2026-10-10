import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { PlansView } from './billing/plan-catalogue';
import { BillingSummary } from './billing/summary';
import { BillingHero } from './billing/hero';
import { billingNotices } from './billing/notices';
import { resolveBillingLocale } from './billing/presentation-formatters';

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
	const locale = resolveBillingLocale();
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
			locale,
		});
	} else {
		content = createElement(BillingSummary, {
			data: state.data,
			state,
			onCancel,
			locale,
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
		createElement(BillingHero, { state, onRefresh, onSetView }),
		...(state.status === 'READY' && state.view === 'PLANS'
			? billingNotices(state.data, state)
			: []),
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
		content
	);
}

export {
	BillingSummary,
	BillingSummaryView,
	handleCancelDialogKeyDown,
	restoreCancelDialogFocus,
} from './billing/summary';
export { PlanCard, PlansView } from './billing/plan-catalogue';
export { BillingHero } from './billing/hero';
export {
	formatDate,
	formatMoney,
	formatQuantity,
	resolveBillingLocale,
} from './billing/presentation-formatters';
