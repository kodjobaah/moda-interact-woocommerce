import { ReadAccessController } from '../read-access/read-access-controller';
import { BillingController } from '../billing-controller';
import { ConnectionController } from '../connection-controller';
import { MerchantBootstrapController } from '../merchant-bootstrap-controller';
import { StoreCategoryController } from '../store-category-controller';
import { RecoverySummaryController } from '../recovery-summary-controller';
import { RecoveryPolicyController } from '../recovery-policy-controller';
import { FeaturePreferencesController } from '../recovery-settings/feature-preferences-controller';
import { MerchantKnowledgeController } from '../recovery-settings/merchant-knowledge/knowledge-controller';
import { StoreContextSyncController } from '../store-context-sync-controller';

/** Create controllers with the same cross-controller callbacks as the original page. */
export function createPageControllers() {
	const merchant = new MerchantBootstrapController(undefined, () => {
		// This callback runs after all controllers have been constructed.
		// eslint-disable-next-line @typescript-eslint/no-use-before-define
		return connection.refresh();
	});
	const sync = new StoreContextSyncController(undefined, () =>
		merchant.refreshAfterCurrent()
	);
	const connection = new ConnectionController(undefined, () => sync.sync());
	const billing = new BillingController(undefined, () =>
		connection.refresh()
	);
	const category = new StoreCategoryController(
		undefined,
		() => merchant.refreshAfterCurrent(),
		() => connection.refresh()
	);

	const recoverySummary = new RecoverySummaryController();
	const recoveryPolicy = new RecoveryPolicyController(undefined, () =>
		recoverySummary.refresh(true)
	);
	const readAccess = new ReadAccessController();
	const featurePreferences = new FeaturePreferencesController();
	const merchantKnowledge = new MerchantKnowledgeController();
	return {
		connection,
		merchant,
		billing,
		sync,
		category,
		recoverySummary,
		recoveryPolicy,
		readAccess,
		featurePreferences,
		merchantKnowledge,
	};
}
