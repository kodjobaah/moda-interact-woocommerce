import { createElement } from '@wordpress/element';
import { BillingScreen } from '../billing-screen';
import { OverviewScreen } from '../overview-screen';
import { RecoverySettingsScreen } from '../recovery-settings/recovery-settings-screen';
import { SurfaceNavigation } from './surface-navigation';

// Connected-only screens, separate from the connection status panel.
export function ConnectedWorkspace({
	activeSurface,
	merchantState,
	billingState,
	syncState,
	categoryState,
	recoverySummaryState,
	actions,
	showSurfaceNavigation = true,
}) {
	let activeContent;
	if (activeSurface === 'BILLING') {
		activeContent = createElement(BillingScreen, {
			key: 'billing',
			state: billingState,
			onRefresh: actions.refreshBilling,
			onLoadPlans: actions.loadPlans,
			onSelectPlan: actions.selectPlan,
			onCancel: actions.cancelPlan,
			onSetView: actions.setBillingView,
		});
	} else if (activeSurface === 'RECOVERY') {
		activeContent = createElement(RecoverySettingsScreen, {
			key: 'recovery-settings',
			state: categoryState,
			onRefresh: actions.refreshCategory,
			onChoose: actions.chooseCategory,
			onToggleMapping: actions.toggleMapping,
			onSave: actions.saveCategory,
			summaryState: recoverySummaryState,
			onRefreshSummary: actions.refreshRecoverySummary,
		});
	} else {
		activeContent = createElement(OverviewScreen, {
			key: 'overview',
			state: merchantState,
			onRefresh: actions.refreshMerchant,
			syncState,
			onSync: actions.syncStoreContext,
		});
	}

	return createElement(
		'div',
		{ className: 'moda-interact-surfaces' },
		showSurfaceNavigation
			? createElement(SurfaceNavigation, {
					activeSurface,
					onSelect: actions.selectSurface,
				})
			: null,
		activeContent
	);
}
