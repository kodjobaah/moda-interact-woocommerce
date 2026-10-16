import { createElement } from '@wordpress/element';
import { PurchaseHistoryScreen } from './billing/purchase-history-screen';
import { __ } from '@wordpress/i18n';
import { PlansView } from './billing/plan-catalogue';
import { BillingSummary } from './billing/summary';
import { TopUpSection } from './billing/top-up-section';
import { BillingHero, BillingViewSwitch } from './billing/hero';
import { PurchasedCreditHistoryCard } from './billing/purchased-credit-history-card';
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
	onPurchaseTopUp,
	onSetView,
	history,
}) {
	const locale = resolveBillingLocale();
	const showHistory =
		state.status === 'READY' &&
		state.view === 'PURCHASE_HISTORY' &&
		state.data?.surfaces.purchaseHistoryAllowed;
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
	} else if (showHistory) {
		content = createElement(PurchaseHistoryScreen, {
			history,
			locale,
			onBack: () => onSetView('TOP_UPS'),
		});
	} else if (state.view === 'PLANS') {
		content = createElement(PlansView, {
			state,
			onSelect: onSelectPlan,
			onRetry: onLoadPlans,
			locale,
		});
	} else if (state.view === 'TOP_UPS') {
		content = createElement(TopUpSection, {
			data: state.data,
			state,
			onPurchase: onPurchaseTopUp,
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
			'aria-labelledby': showHistory
				? 'moda-purchase-history-title'
				: 'moda-interact-billing-heading',
			'aria-busy':
				state.status === 'LOADING' ||
				state.plansStatus === 'LOADING' ||
				state.command === 'SUBMITTING' ||
				Boolean(showHistory && history?.state.status === 'LOADING'),
		},
		showHistory
			? null
			: createElement(BillingHero, { state, onRefresh, onSetView }),
		showHistory
			? null
			: createElement(BillingViewSwitch, { state, onSetView }),
		state.status === 'READY' && !showHistory
			? createElement(PurchasedCreditHistoryCard, {
					onManage: () => onSetView('PURCHASE_HISTORY'),
					available: state.data.surfaces.purchaseHistoryAllowed,
				})
			: null,
		state.status === 'READY' && !showHistory && state.data?.surfaces?.usageHistoryAllowed
			? createElement('p', { className: 'moda-usage__billing-link' },
				createElement('a', { href: 'admin.php?page=moda-interact-usage-history', className: 'button' },
					__('Usage history', 'moda-interact')))
			: null,
		...(state.status === 'READY' && state.view !== 'SUMMARY' && !showHistory
			? billingNotices(state.data, state)
			: []),
		state.error &&
			!(
				state.feedbackContext === 'TOP_UP' &&
				state.error === 'billing_operation_failed'
			)
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
export { TopUpSection } from './billing/top-up-section';
export { BillingHero } from './billing/hero';
export {
	formatDate,
	formatMoney,
	formatQuantity,
	resolveBillingLocale,
} from './billing/presentation-formatters';
