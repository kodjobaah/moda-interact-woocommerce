import { ReadAccessController } from '../read-access/read-access-controller';
import { BillingController } from '../billing-controller';
import { ConnectionController } from '../connection-controller';
import { MerchantBootstrapController } from '../merchant-bootstrap-controller';
import { StoreCategoryController } from '../store-category-controller';
import { RecoverySummaryController } from '../recovery-summary-controller';
import { StoreContextSyncController } from '../store-context-sync-controller';

/** Create controllers with the same cross-controller callbacks as the original page. */
export function createPageControllers() {
	const merchant = new MerchantBootstrapController(undefined, () =>
		connection.refresh()
	);
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
	const readAccess = new ReadAccessController();
	return {
		connection,
		merchant,
		billing,
		sync,
		category,
		recoverySummary,
		readAccess,
	};
}
