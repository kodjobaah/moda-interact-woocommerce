import { createStoreContextSyncClient } from './store-context-sync-client';

/** A separate action: failure must never change connection or billing state. */
export class StoreContextSyncController {
	constructor(client = createStoreContextSyncClient(), onSaved = () => {}) {
		this.client = client;
		this.onSaved = onSaved;
		this.listeners = new Set();
		this.connectionStatus = 'LOADING';
		this.disposed = false;
		this.revision = 0;
		this.operation = null;
		this.state = { status: 'IDLE' };
	}

	subscribe(listener) {
		if (this.disposed) {
			return () => {};
		}
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	setConnectionStatus(status) {
		if (this.disposed || this.connectionStatus === status) {
			return;
		}
		this.connectionStatus = status;
		if (status !== 'CONNECTED') {
			this.revision++;
			this.publish({ status: 'IDLE' });
		}
	}

	sync() {
		if (this.disposed || this.connectionStatus !== 'CONNECTED') {
			return Promise.resolve(this.state);
		}
		if (this.operation) {
			return this.operation;
		}
		const revision = ++this.revision;
		this.publish({ status: 'SYNCING' });
		const operation = this.client
			.sync()
			.then(async () => {
				if (this.isCurrent(revision)) {
					this.publish({ status: 'SYNCED' });
					// Read the existing bootstrap projection again; do not trigger reconnect.
					try {
						await this.onSaved();
					} catch {
						// Store context is saved; the overview handles its own read errors.
					}
				}
				return this.state;
			})
			.catch(() => {
				if (this.isCurrent(revision)) {
					this.publish({ status: 'ERROR' });
				}
				return this.state;
			})
			.finally(() => {
				if (this.operation === operation) {
					this.operation = null;
				}
			});
		this.operation = operation;
		return operation;
	}

	dispose() {
		this.disposed = true;
		this.revision++;
		this.listeners.clear();
	}

	isCurrent(revision) {
		return (
			!this.disposed &&
			this.connectionStatus === 'CONNECTED' &&
			this.revision === revision
		);
	}

	publish(state) {
		if (this.disposed) {
			return;
		}
		this.state = state;
		for (const listener of this.listeners) {
			listener(state);
		}
	}
}
