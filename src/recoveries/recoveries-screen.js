import { createElement } from '@wordpress/element';
import { RecoveryFilterPanel } from './filters/recovery-filter-panel';
import { useRecoveryFilters } from './filters/use-recovery-filters';
import { RecoveryList } from './list/recovery-list';
import { RecoveriesHeader } from './recoveries-header';

/**
 * Stage 1: fully mounted page, deliberately no hosted API or fixture data.
 *
 * @param {Object}      root0          - Component props.
 * @param {string|null} root0.timeZone - Merchant time zone.
 * @return {Object} Screen element.
 */
export function RecoveriesScreen({ timeZone = null }) {
	const filters = useRecoveryFilters(timeZone);
	return createElement(
		'div',
		{
			className: 'moda-recoveries',
			'aria-labelledby': 'moda-recoveries-heading',
		},
		createElement(RecoveriesHeader),
		createElement(RecoveryFilterPanel, {
			filters: filters.filters,
			today: filters.today,
			error: filters.error,
			timeZone,
			onChange: filters.update,
			onPreset: filters.selectPreset,
			onClear: filters.clear,
			onSubmit: filters.submit,
		}),
		createElement(RecoveryList, { state: 'UNAVAILABLE' })
	);
}
