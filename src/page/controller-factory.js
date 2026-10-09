import { BillingController } from '../billing-controller';
import { ConnectionController } from '../connection-controller';
import { MerchantBootstrapController } from '../merchant-bootstrap-controller';
import { StoreCategoryController } from '../store-category-controller';
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

	return { connection, merchant, billing, sync, category };
}
