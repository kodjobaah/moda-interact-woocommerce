import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { HISTORY_FILTERS } from './purchase-history-contract';

const FILTER_NAMES = {
	ACTIVE: __('Active', 'moda-interact'),
	WITHDRAWN: __('Refund pending', 'moda-interact'),
	COMPLETED: __('Completed', 'moda-interact'),
	REFUNDED: __('Refunded', 'moda-interact'),
	ALL: __('All', 'moda-interact'),
};

/**
 * Native buttons, not ARIA tabs: keyboard behaviour remains standard.
 * @param {Object}                   root0                - Filter control inputs.
 * @param {string}                   root0.filter         - Selected history filter.
 * @param {(filter: string) => void} root0.onFilterChange - Change the filter.
 * @param {boolean}                  root0.disabled       - Disable controls while loading.
 */
export function PurchaseHistoryFilters({ filter, onFilterChange, disabled }) {
	return createElement(
		'nav',
		{
			className: 'moda-purchase-history__filters',
			'aria-label': __('Purchase history filters', 'moda-interact'),
		},
		...HISTORY_FILTERS.map((value) =>
			createElement(
				'button',
				{
					key: value,
					type: 'button',
					className: value === filter ? 'is-active' : '',
					'aria-pressed': value === filter,
					disabled,
					onClick: () => onFilterChange(value),
				},
				FILTER_NAMES[value]
			)
		)
	);
}
