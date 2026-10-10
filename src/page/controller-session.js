// Own subscriptions and cleanup separately from React and domain controllers.
export function createControllerSession(controllers, listeners) {
	let previousConnectionStatus = 'LOADING';
	const unsubscriptions = [
		controllers.category.subscribe(listeners.onCategory),
		controllers.recoverySummary.subscribe(listeners.onRecoverySummary),
		controllers.readAccess.subscribe(listeners.onReadAccess),
		controllers.sync.subscribe(listeners.onSync),
		controllers.merchant.subscribe(listeners.onMerchant),
		controllers.billing.subscribe(listeners.onBilling),
		controllers.connection.subscribe((nextState) => {
			listeners.onConnection(nextState);
			const status = nextState.connection.status;
			controllers.readAccess.setConnection(nextState.connection);
			controllers.merchant.setConnectionStatus(status);
			controllers.billing.setConnectionStatus(status);
			controllers.sync.setConnectionStatus(status);
			if (
				previousConnectionStatus === 'CONNECTED' &&
				status !== 'CONNECTED'
			) {
				listeners.onConnectionLost();
			}
			previousConnectionStatus = status;
			controllers.category.setConnectionStatus(status);
			controllers.recoverySummary.setConnectionStatus(status);
		}),
	];
	let disposed = false;

	return {
		controllers,
		start() {
			if (!disposed) {
				controllers.connection.refresh();
			}
		},
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			for (const unsubscribe of unsubscriptions.reverse()) {
				unsubscribe();
			}
			for (const name of [
				'connection',
				'merchant',
				'billing',
				'sync',
				'category',
				'recoverySummary',
				'readAccess',
			]) {
				controllers[name].dispose();
			}
		},
	};
}
