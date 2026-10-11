import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { RecoveryRow } from './recovery-row';
import { RecoveryPagination } from './recovery-pagination';
import { RecoveryResultsState } from '../states/recovery-results-state';

/**
 * All data props are supplied by a future API adapter; never generate demo rows.
 *
 * @param {Object}     root0                - List presentation data.
 * @param {string}     root0.state          - Read state.
 * @param {Array}      root0.items          - Recovery DTOs.
 * @param {string}     root0.dateRangeLabel - Human-readable selected range.
 * @param {Object}     root0.pagination     - Pagination display state.
 * @param {() => void} root0.onRetry        - Retry callback.
 * @param {() => void} root0.onClear        - Clear-filters callback.
 * @return {Object} List element.
 */
export function RecoveryList({
	state = 'UNAVAILABLE',
	items = [],
	dateRangeLabel,
	pagination = {},
	onRetry,
	onClear,
}) {
	const hasRows = state === 'READY' && items.length > 0;
	return createElement(
		'section',
		{
			className: 'moda-recoveries__panel moda-recoveries__results',
			'aria-labelledby': 'moda-recoveries-results-title',
			'aria-busy': state === 'LOADING',
		},
		createElement(
			'div',
			{ className: 'moda-recoveries__results-heading' },
			createElement(
				'h2',
				{ id: 'moda-recoveries-results-title' },
				__('Recoveries', 'moda-interact')
			),
			dateRangeLabel ? createElement('span', null, dateRangeLabel) : null
		),
		hasRows
			? createElement(
					'ul',
					{ className: 'moda-recoveries__rows' },
					...items.map((item) =>
						createElement(RecoveryRow, { key: item.id, item })
					)
				)
			: createElement(RecoveryResultsState, {
					state: state === 'READY' ? 'EMPTY' : state,
					onRetry,
					onClear,
				}),
		createElement(RecoveryPagination, pagination)
	);
}
