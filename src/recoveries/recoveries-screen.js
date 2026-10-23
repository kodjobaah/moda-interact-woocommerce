import { createElement } from '@wordpress/element';
import { RecoveryFilterPanel } from './filters/recovery-filter-panel';
import { presetDates } from './filters/recovery-date-presets';
import { useRecoveryFilters } from './filters/use-recovery-filters';
import { useRecoveries } from './hooks/use-recoveries';
import { RecoveryList } from './list/recovery-list';
import {
	recoveryDisplayRows,
	recoveryPaginationLabel,
	recoveryRangeLabel,
} from './recoveries-presentation';
import { RecoveriesHeader } from './recoveries-header';
import {
	readRecoveryDetailRoute,
	recoveryDetailHref,
} from './detail/detail-navigation';
import { ConnectedRecoveryDetailScreen } from './detail/connected-recovery-detail-screen';
import { CustomerRecoverySelectionPanel } from './customer-selection/selection-panel';

/**
 * Display layer only. Live data and pagination are owned by the read controller.
 *
 * @param {Object}      root0          - Component props.
 * @param {string|null} root0.timeZone - Bootstrap time zone fallback.
 * @return {Object} Screen element.
 */
function RecoveriesListScreen({ timeZone: bootstrapTimeZone = null }) {
	const recoveries = useRecoveries();
	const { status, data } = recoveries.state;
	const timeZone = data?.timeZone ?? bootstrapTimeZone;
	const filters = useRecoveryFilters(timeZone, data);
	const busy = status === 'LOADING';

	const onSubmit = (event) => {
		if (filters.submit(event)) {
			recoveries.applyFilters(filters.filters);
		}
	};
	const onPreset = (preset) => {
		filters.selectPreset(preset);
		if (preset !== 'CUSTOM') {
			recoveries.applyFilters({
				...filters.filters,
				...presetDates(preset, filters.today),
			});
		}
	};
	const onClear = () => {
		filters.clear();
		recoveries.clearFilters();
	};
	let listState = 'LOADING';
	if (status === 'READY') {
		listState = 'READY';
	}
	if (status === 'ERROR') {
		listState = 'ERROR';
	}
	let pagination = {};
	if (status === 'READY' && data) {
		pagination = {
			hasPrevious: data.hasPrevious,
			hasNext: data.hasNext,
			pageLabel: recoveryPaginationLabel(data),
			onPrevious: () => recoveries.goToPage(data.page - 1),
			onNext: () => recoveries.goToPage(data.page + 1),
		};
	}
	return createElement(
		'div',
		{
			className: 'moda-recoveries',
			'aria-labelledby': 'moda-recoveries-heading',
		},
		createElement(RecoveriesHeader, {
			onRefresh: recoveries.refresh,
			disabled: busy,
		}),
		createElement(CustomerRecoverySelectionPanel),
		createElement(RecoveryFilterPanel, {
			filters: filters.filters,
			today: filters.today,
			error: filters.error,
			busy,
			timeZone,
			onChange: filters.update,
			onPreset,
			onClear,
			onSubmit,
		}),
		createElement(RecoveryList, {
			state: listState,
			items: status === 'READY' && data ? recoveryDisplayRows(data) : [],
			dateRangeLabel:
				status === 'READY' && data ? recoveryRangeLabel(data) : null,
			getDetailHref:
				status === 'READY' && data
					? (id) => recoveryDetailHref(id, data)
					: null,
			pagination,
			onRetry: recoveries.refresh,
			onClear,
		})
	);
}

/**
 * Keep WordPress's existing Recoveries submenu active for list and detail URLs.
 * @param {Object}      root0
 * @param {string|null} root0.timeZone
 */
export function RecoveriesScreen({ timeZone = null }) {
	const detailRoute = readRecoveryDetailRoute(
		globalThis.location?.search ?? ''
	);
	return detailRoute
		? createElement(ConnectedRecoveryDetailScreen, { route: detailRoute })
		: createElement(RecoveriesListScreen, { timeZone });
}
