import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

export function billingNotices(data, state) {
	const notices = [];
	const add = (message, className = 'moda-interact-billing-notice') =>
		notices.push(
			createElement(
				'p',
				{ className, role: 'status', key: notices.length },
				message
			)
		);
	if (data.experienceState === 'FROZEN') {
		add(
			createElement(
				'span',
				null,
				__('Recurring billing recovery is required.', 'moda-interact'),
				' ',
				__(
					'Paid included credits are temporarily unavailable. Purchased credits and remaining lifetime Free credits remain usable; promotional credits follow their existing eligibility.',
					'moda-interact'
				)
			)
		);
	}
	if (data.experienceState === 'BILLING_ATTENTION') {
		add(
			__(
				'Billing needs attention. Plan changes are unavailable while Moda verifies billing status.',
				'moda-interact'
			)
		);
	}
	if (data.experienceState === 'NO_CONTRACT') {
		add(
			__(
				'No recurring billing contract is available for this store.',
				'moda-interact'
			)
		);
	}
	if (state.notice === 'CANCEL_ACCEPTED') {
		add(
			__('Cancellation request accepted.', 'moda-interact'),
			'moda-interact-billing-success'
		);
	}
	if (state.data.pendingPlan) {
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
		add(
			sprintf(
				/* translators: 1: plan name, 2: pending plan operation state. */
				__('%1$s: %2$s', 'moda-interact'),
				state.data.pendingPlan.displayName,
				labels[state.data.pendingPlan.state] ??
					__('Plan status unavailable', 'moda-interact')
			)
		);
	}
	if (state.data.pendingCancellation) {
		const labels = {
			INITIATING: __(
				'Starting the cancellation request',
				'moda-interact'
			),
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
		add(
			labels[state.data.pendingCancellation.state] ??
				__('Cancellation status unavailable', 'moda-interact')
		);
	}
	return notices;
}
