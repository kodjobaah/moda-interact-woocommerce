import { createElement } from '@wordpress/element';
import { ConnectedBillingScreen } from '../billing/connected-billing-screen';
import { OverviewScreen } from '../overview-screen';
import { PromotionsScreen } from '../promotions/promotions-screen';
import { RecoveriesScreen } from '../recoveries/recoveries-screen';
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
	recoveryPolicyState,
	actions,
	showSurfaceNavigation = true,
}) {
	let activeContent;
	if (activeSurface === 'RECOVERIES') {
		let timeZone = null;
		if (merchantState.status === 'READY') {
			const context = merchantState.data?.internationalContext;
			timeZone = context?.timeZone ?? null;
		}
		activeContent = createElement(RecoveriesScreen, {
			key: 'recoveries',
			timeZone,
		});
	} else if (activeSurface === 'BILLING') {
		activeContent = createElement(ConnectedBillingScreen, {
			key: 'billing',
			state: billingState,
			onRefresh: actions.refreshBilling,
			onLoadPlans: actions.loadPlans,
			onSelectPlan: actions.selectPlan,
			onCancel: actions.cancelPlan,
			onPurchaseTopUp: actions.purchaseRecoveryCredits,
			onSetView: actions.setBillingView,
		});
	} else if (activeSurface === 'PROMOTIONS') {
		activeContent = createElement(PromotionsScreen, { key: 'promotions' });
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
			policyState: recoveryPolicyState,
			onRefreshPolicy: actions.refreshRecoveryPolicy,
			onSavePolicy: actions.saveRecoveryPolicy,
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
