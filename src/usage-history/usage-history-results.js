import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { recoveryDetailHref } from '../recoveries/detail/detail-navigation';
import { usageFormatters } from './usage-history-format';

/** Labels are presentation-only. Never infer a charge source from plan or period. */
export function usageChargeLabel(value) {
	switch (value) {
		case 'LIFETIME_FREE_CREDITS':
			return __('Lifetime Free credits', 'moda-interact');
		case 'INCLUDED_PLAN_ALLOWANCE':
			return __('Included plan allowance', 'moda-interact');
		case 'PURCHASED_TOP_UP':
			return __('Purchased top-up', 'moda-interact');
		case 'PROMOTIONAL_CREDITS':
			return __('Promotional credits', 'moda-interact');
		case 'NOT_APPLICABLE':
			return __('Not applicable', 'moda-interact');
		case 'UNATTRIBUTED':
			return __('Unattributed', 'moda-interact');
		default:
			// v1 carries no attribution evidence; do not mislabel as UNATTRIBUTED.
			return __('Not available', 'moda-interact');
	}
}

export function UsageHistoryResults({ history, locale }) {
	const { state } = history;
	const { data } = state;
	if (!data || state.status !== 'READY') {
		return null;
	}
	const { formatNumber, formatDate } = usageFormatters(locale);
	const paging = data.usagePagination;
	const events = data.usageEvents;
	const first = events.length ? (state.page - 1) * state.pageSize + 1 : 0;
	const last = events.length ? first + events.length - 1 : 0;
	const headers = [
		__('Event type', 'moda-interact'),
		__('Recovery', 'moda-interact'),
		__('Customer', 'moda-interact'),
		__('Charged against', 'moda-interact'),
		__('Quantity', 'moda-interact'),
		__('Recorded at', 'moda-interact'),
	];
	return createElement(
		'section',
		{
			className: 'moda-usage__results',
			'aria-live': 'polite',
		},
		createElement(
			'div',
			{ className: 'moda-usage__period-title' },
			paging.periodStart && paging.periodEnd
				? createElement(
						'h2',
						null,
						`${formatDate(paging.periodStart)} — ${formatDate(paging.periodEnd)}`
					)
				: state.view === 'current' && paging.billId === null
					? createElement(
							'h2',
							null,
							__('Lifetime usage', 'moda-interact')
						)
					: null,
			createElement(
				'p',
				null,
				__('Recorded usage', 'moda-interact'),
				': ',
				formatNumber(paging.totalQuantity)
			)
		),
		!events.length
			? createElement(
					'p',
					{ role: 'status' },
					__('No recorded usage for this period.', 'moda-interact')
				)
			: createElement(
					'div',
					{ className: 'moda-usage__table-wrap' },
					createElement(
						'table',
						{ className: 'widefat striped moda-usage__table' },
						createElement(
							'thead',
							null,
							createElement(
								'tr',
								null,
								...headers.map((label) =>
									createElement(
										'th',
										{ key: label, scope: 'col' },
										label
									)
								)
							)
						),
						createElement(
							'tbody',
							null,
							...events.map((event) => {
								const source = event.sourceRecovery;
								const href = source
									? recoveryDetailHref(source.recoveryId)
									: null;
								return createElement(
									'tr',
									{ key: event.id },
									createElement(
										'td',
										null,
										event.metric === 'RECOVERY_CONVERSATION'
											? __(
													'Recovery conversation',
													'moda-interact'
												)
											: __('Unavailable', 'moda-interact')
									),
									createElement(
										'td',
										null,
										href
											? createElement(
													'a',
													{ href },
													__(
														'View recovery',
														'moda-interact'
													)
												)
											: __('Unlinked', 'moda-interact')
									),
									createElement(
										'td',
										{ dir: 'auto' },
										source?.customerName ||
											__('Unlinked', 'moda-interact')
									),
									createElement(
										'td',
										null,
										usageChargeLabel(event.chargedAgainst)
									),
									createElement(
										'td',
										null,
										formatNumber(event.quantity)
									),
									createElement(
										'td',
										null,
										formatDate(event.occurredAt, true)
									)
								);
							})
						)
					)
				),
		createElement(
			'nav',
			{
				className: 'moda-usage__paging',
				'aria-label': __('Usage history pages', 'moda-interact'),
			},
			createElement(
				'span',
				null,
				`${formatNumber(first)}–${formatNumber(last)} / ${formatNumber(paging.total)}`
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: state.page <= 1,
					onClick: () => history.setPage(state.page - 1),
				},
				__('Previous', 'moda-interact')
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: state.page * state.pageSize >= paging.total,
					onClick: () => history.setPage(state.page + 1),
				},
				__('Next', 'moda-interact')
			)
		)
	);
}
