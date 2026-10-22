import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { resolveBillingLocale } from '../billing/presentation-formatters';
import { UsageHistoryToolbar } from './usage-history-toolbar';
import { UsageHistoryResults } from './usage-history-results';
import { useUsageHistory } from './use-usage-history';

const BILLING_HREF = 'admin.php?page=moda-interact-billing';
const CONNECTION_HREF = 'admin.php?page=moda-interact';

export function UsageHistoryView({ history, locale = resolveBillingLocale() }) {
	const { state } = history;
	const busy = state.status === 'LOADING' || state.status === 'IDLE';
	let message = null;
	if (busy) {
		message = __('Loading usage history…', 'moda-interact');
	} else if (state.status === 'UNAVAILABLE') {
		message = __(
			'Usage history is currently unavailable for this store.',
			'moda-interact'
		);
	} else if (state.status === 'RECONNECT') {
		message = __(
			'The local connection needs to be re-established. Your Moda account and store data have not been removed.',
			'moda-interact'
		);
	} else if (state.status === 'DENIED') {
		message = __(
			'You do not have permission to view usage history.',
			'moda-interact'
		);
	} else if (state.status === 'INVALID_CURSOR') {
		message = __(
			'This usage history page is no longer valid. Clear the selection to start again.',
			'moda-interact'
		);
	} else if (state.status === 'INVALID_PERIOD') {
		message = __(
			'The selected billing period is unavailable.',
			'moda-interact'
		);
	} else if (state.status === 'FAILED') {
		message = __(
			'Usage history could not be loaded. Please try again.',
			'moda-interact'
		);
	}
	return createElement(
		'section',
		{
			className: 'moda-usage',
			'aria-labelledby': 'moda-usage-title',
			'aria-busy': busy,
		},
		createElement(
			'nav',
			{
				className: 'moda-usage__breadcrumb',
				'aria-label': __('Billing', 'moda-interact'),
			},
			createElement(
				'a',
				{ href: BILLING_HREF },
				__('Back to billing', 'moda-interact')
			),
			createElement('span', { 'aria-hidden': true }, ' / '),
			createElement('span', null, __('Usage history', 'moda-interact'))
		),
		createElement(
			'div',
			{ className: 'moda-usage__card' },
			createElement(
				'header',
				{ className: 'moda-usage__header' },
				createElement(
					'div',
					null,
					createElement(
						'h1',
						{ id: 'moda-usage-title' },
						__('Usage history', 'moda-interact')
					),
					createElement(
						'p',
						null,
						__(
							'Review your recorded recovery conversation usage.',
							'moda-interact'
						)
					)
				),
				createElement(
					'button',
					{
						type: 'button',
						className: 'button',
						disabled:
							busy ||
							state.status === 'RECONNECT' ||
							state.status === 'DENIED',
						onClick: history.refresh,
					},
					__('Refresh', 'moda-interact')
				)
			),
			createElement(UsageHistoryToolbar, { history, locale }),
			message
				? createElement(
						'div',
						{
							className:
								state.status === 'FAILED' ||
								state.status === 'RECONNECT' ||
								state.status === 'DENIED'
									? 'moda-interact-message moda-interact-message--error'
									: 'moda-interact-message',
							role:
								state.status === 'FAILED' ||
								state.status === 'RECONNECT' ||
								state.status === 'DENIED'
									? 'alert'
									: 'status',
						},
						createElement('p', null, message),
						state.status === 'RECONNECT'
							? createElement(
									'a',
									{ href: CONNECTION_HREF, className: 'button' },
									__('Reconnect Moda Interact', 'moda-interact')
								)
							: null,
						state.status === 'INVALID_CURSOR' ||
							state.status === 'INVALID_PERIOD'
							? createElement(
									'button',
									{
										type: 'button',
										className: 'button',
										onClick: history.clearCursor,
									},
									__('Clear filters', 'moda-interact')
								)
							: null,
						state.status === 'FAILED'
							? createElement(
									'button',
									{
										type: 'button',
										className: 'button',
										onClick: history.refresh,
									},
									__('Retry', 'moda-interact')
								)
							: null
					)
				: null,
			createElement(UsageHistoryResults, { history, locale })
		)
	);
}

/** A fresh controller is mounted for each connected credential generation. */
export function UsageHistoryScreen() {
	return createElement(UsageHistoryView, { history: useUsageHistory() });
}
