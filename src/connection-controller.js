import { createConnectionClient } from './connection-client';

export class ConnectionController {
	constructor(
		client = createConnectionClient(),
		onFirstConnected = () => {}
	) {
		this.onFirstConnected = onFirstConnected;
		this.client = client;
		this.listeners = new Set();
		this.revision = 0;
		this.actionPromise = null;
		this.readPromise = null;
		this.disposed = false;
		this.state = {
			connection: { status: 'LOADING' },
			pendingAction: null,
			actionError: false,
		};
	}

	subscribe(listener) {
		if (this.disposed) {
			return () => {};
		}
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	refresh() {
		if (this.disposed || this.actionPromise || this.readPromise) {
			return this.readPromise ?? Promise.resolve(this.state);
		}

		const revision = ++this.revision;
		const isInitialLoad = this.state.connection.status === 'LOADING';
		this.publish({
			...this.state,
			connection: isInitialLoad
				? { status: 'LOADING' }
				: this.state.connection,
			pendingAction: 'refresh',
			actionError: false,
		});

		const operation = this.client
			.getStatus()
			.then((connection) => {
				if (this.isCurrent(revision)) {
					this.publish({
						connection,
						pendingAction: null,
						actionError: false,
					});
				}
				return this.state;
			})
			.catch(() => {
				if (this.isCurrent(revision)) {
					this.publish({
						connection: { status: 'LOAD_FAILED' },
						pendingAction: null,
						actionError: false,
					});
				}
				return this.state;
			});
		const operationWithFinally = operation.finally(() => {
			if (this.readPromise === operationWithFinally) {
				this.readPromise = null;
			}
		});
		this.readPromise = operationWithFinally;
		return operationWithFinally;
	}

	connect() {
		if (this.disposed || this.state.pendingAction === 'connect') {
			return this.actionPromise ?? Promise.resolve(this.state);
		}
		if (this.actionPromise) {
			return this.actionPromise;
		}
		if (
			!['DISCONNECTED', 'RECONNECT_REQUIRED'].includes(
				this.state.connection.status
			)
		) {
			return Promise.resolve(this.state);
		}

		const firstConnection = this.state.connection.status === 'DISCONNECTED';
		const revision = ++this.revision;
		this.publish({
			...this.state,
			pendingAction: 'connect',
			actionError: false,
		});

		const operation = this.client
			.connect()
			.then((connection) => {
				if (this.isCurrent(revision)) {
					this.publish({
						connection,
						pendingAction: null,
						actionError: false,
					});
					if (firstConnection) {
						try {
							// Independent best-effort action; never fail a successful Connect.
							Promise.resolve(this.onFirstConnected()).catch(
								() => {}
							);
						} catch {
							// Connection has already been persisted successfully.
						}
					}
				}
				return this.state;
			})
			.catch(() => {
				if (this.isCurrent(revision)) {
					this.publish({
						...this.state,
						pendingAction: null,
						actionError: true,
					});
				}
				return this.state;
			})
			.finally(() => {
				if (this.actionPromise === operation) {
					this.actionPromise = null;
				}
			});

		this.actionPromise = operation;
		return operation;
	}

	dispose() {
		this.disposed = true;
		this.revision += 1;
		this.listeners.clear();
	}

	isCurrent(revision) {
		return !this.disposed && revision === this.revision;
	}

	publish(state) {
		if (this.disposed) {
			return;
		}
		this.state = state;
		for (const listener of this.listeners) {
			listener(this.state);
		}
	}
}
