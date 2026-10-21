import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { USAGE_KINDS } from './usage-history-controller';
import { usageFormatters } from './usage-history-format';

const PERIOD_VIEW = [
	['current', __('Current period', 'moda-interact')],
	['past', __('Past periods', 'moda-interact')],
];

export function UsageHistoryToolbar({ history, locale }) {
	const { state } = history;
	const { formatDate } = usageFormatters(locale);
	const busy = state.status === 'LOADING';
	const periods = state.data?.periodPage?.items ?? [];
	return createElement(
		'div',
		{ className: 'moda-usage__controls' },
		createElement(
			'nav',
			{
				className: 'moda-usage__tabs',
				'aria-label': __('Billing period', 'moda-interact'),
			},
			...PERIOD_VIEW.map(([view, label]) =>
				createElement(
					'button',
					{
						key: view,
						type: 'button',
						className: view === state.view ? 'is-active' : '',
						'aria-current':
							state.view === view ? 'page' : undefined,
						disabled: busy,
						onClick: () => history.setView(view),
					},
					label
				)
			)
		),
		createElement(
			'div',
			{ className: 'moda-usage__filters' },
			createElement(
				'label',
				null,
				__('Billing period', 'moda-interact'),
				createElement(
					'select',
					{
						value: state.periodId,
						disabled: busy || !periods.length,
						onChange: (event) =>
							history.setPeriod(event.target.value),
					},
					createElement(
						'option',
						{ value: '' },
						__('Select a period', 'moda-interact')
					),
					...periods.map((period) =>
						createElement(
							'option',
							{
								key: period.id,
								value: period.id,
							},
							`${formatDate(period.periodStart)} — ${formatDate(period.periodEnd)}`
						)
					)
				)
			),
			createElement(
				'label',
				null,
				__('Event type', 'moda-interact'),
				createElement(
					'select',
					{
						value: state.kind,
						disabled: busy,
						onChange: (event) =>
							history.setKind(event.target.value),
					},
					...USAGE_KINDS.map((kind) =>
						createElement(
							'option',
							{
								key: kind,
								value: kind,
							},
							kind === 'ALL'
								? __('All events', 'moda-interact')
								: __('Recovery conversation', 'moda-interact')
						)
					)
				)
			),
			createElement(
				'label',
				null,
				__('Rows per page', 'moda-interact'),
				createElement(
					'select',
					{
						value: state.pageSize,
						disabled: busy,
						onChange: (event) =>
							history.setPageSize(Number(event.target.value)),
					},
					...[10, 25, 50, 100].map((size) =>
						createElement(
							'option',
							{
								key: size,
								value: size,
							},
							String(size)
						)
					)
				)
			)
		),
		periods.length
			? createElement(
					'nav',
					{
						className: 'moda-usage__period-paging',
						'aria-label': __('Billing periods', 'moda-interact'),
					},
					...[
						[
							state.data.periodPage.previousCursor,
							__('Previous', 'moda-interact'),
						],
						[
							state.data.periodPage.nextCursor,
							__('Next', 'moda-interact'),
						],
					].map(([cursor, label], index) =>
						createElement(
							'button',
							{
								key: index,
								type: 'button',
								className: 'button',
								disabled: busy || !cursor,
								onClick: () => history.setPeriodCursor(cursor),
							},
							label
						)
					)
				)
			: null
	);
}
