import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { CapacitySummary } from './capacity-summary';
import { billingNotices } from './notices';
import {
	CancelDialog,
	handleCancelDialogKeyDown,
	restoreCancelDialogFocus,
} from './cancel-dialog';
import {
	formatDate,
	formatMoney,
	resolveBillingLocale,
} from './presentation-formatters';

export { handleCancelDialogKeyDown, restoreCancelDialogFocus };

function dataRow(label, value, key = label) {
	return [
		createElement('dt', { key: `${key}-label` }, label),
		createElement('dd', { key: `${key}-value` }, value),
	];
}

function SummaryCard({ title, children, className = '' }) {
	return createElement(
		'section',
		{ className: `moda-interact-billing-card ${className}`.trim() },
		createElement('h3', null, title),
		children
	);
}

export function BillingSummary({
	data,
	state,
	onCancel,
	locale = resolveBillingLocale(),
}) {
	const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
	const keepPlanRef = useRef(null);
	const dialogCancelRef = useRef(null);
	const cancelTriggerRef = useRef(null);
	const dialogWasOpen = useRef(false);
	useEffect(() => {
		if (cancelDialogOpen) {
			keepPlanRef.current?.focus();
		} else if (dialogWasOpen.current) {
			restoreCancelDialogFocus(cancelTriggerRef);
		}
		dialogWasOpen.current = cancelDialogOpen;
	}, [cancelDialogOpen]);
	return createElement(BillingSummaryView, {
		data,
		state,
		onCancel,
		locale,
		cancelDialogOpen,
		setCancelDialogOpen,
		keepPlanRef,
		dialogCancelRef,
		cancelTriggerRef,
	});
}

export function BillingSummaryView({
	data,
	state,
	onCancel,
	locale = resolveBillingLocale(),
	cancelDialogOpen = false,
	setCancelDialogOpen = () => {},
	keepPlanRef = { current: null },
	dialogCancelRef = { current: null },
	cancelTriggerRef = { current: null },
}) {
	const currentPlan = data.currentPlan;
	const frozen = data.experienceState === 'FROZEN';
	const paid = currentPlan?.planKind === 'PAID_METERED';
	const canCancel =
		data.surfaces.cancelSubscriptionAllowed &&
		paid &&
		!data.pendingPlan &&
		!data.pendingCancellation &&
		!currentPlan?.cancelAtPeriodEnd &&
		['ACTIVE', 'FROZEN'].includes(data.experienceState) &&
		state.command === null;
	const rows = currentPlan
		? [
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
						: formatMoney(
								currentPlan.recurringAmountMinor,
								currentPlan.currency,
								locale
							)
				),
				...dataRow(
					__('Billing period', 'moda-interact'),
					__('Every 30 days', 'moda-interact')
				),
				...dataRow(
					__('Next included allowance reset', 'moda-interact'),
					formatDate(currentPlan.currentPeriodEnd, locale)
				),
				...(currentPlan.cancelAtPeriodEnd
					? dataRow(
							__('Paid subscription ends', 'moda-interact'),
							formatDate(
								currentPlan.cancellationEffectiveAt,
								locale
							),
							'cancellation-effective'
						)
					: []),
				...(currentPlan.cancelAtPeriodEnd
					? dataRow(
							__('Subscription status', 'moda-interact'),
							__('Scheduled to end', 'moda-interact')
						)
					: []),
			]
		: [];
	return createElement(
		'div',
		{ className: 'moda-interact-billing-summary' },
		...billingNotices(data, state),
		createElement(
			'div',
			{ className: 'moda-interact-billing-grid' },
			createElement(
				SummaryCard,
				{
					title: __('Current plan', 'moda-interact'),
					className: 'moda-interact-billing-card--current',
				},
				currentPlan
					? createElement(
							'dl',
							{ className: 'moda-interact-details' },
							...rows
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
					? CancelDialog({
							state,
							onCancel,
							setOpen: setCancelDialogOpen,
							keepPlanRef,
							dialogCancelRef,
						})
					: null
			),
			createElement(CapacitySummary, { data, frozen, locale })
		)
	);
}
