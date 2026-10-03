import { createMerchantBootstrapClient } from './merchant-bootstrap-client';

/** @typedef {'IDLE'|'LOADING'|'READY'|'RECONNECT_REQUIRED'|'REMOTE_UNAVAILABLE'|'LOAD_FAILED'} MerchantBootstrapStatus */

export class MerchantBootstrapController {
	constructor(
		client = createMerchantBootstrapClient(),
		onConnectionAttention = () => {}
	) {
		this.client = client;
		this.onConnectionAttention = onConnectionAttention;
		this.listeners = new Set();
		this.connectionStatus = 'LOADING';
		this.revision = 0;
		this.requestPromise = null;
		this.disposed = false;
		/** @type {{ status: MerchantBootstrapStatus, data?: object }} */
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
		if (this.disposed || status === this.connectionStatus) {
			return;
		}
		this.connectionStatus = status;
		this.revision += 1;
		if (status !== 'CONNECTED') {
			this.publish({ status: 'IDLE' });
			return;
		}
		this.refresh();
	}

	refresh() {
		if (this.disposed || this.connectionStatus !== 'CONNECTED') {
			return Promise.resolve(this.state);
		}
		if (this.requestPromise) {
			return this.requestPromise;
		}

		const revision = ++this.revision;
		this.publish({ status: 'LOADING' });
		const operation = this.client
			.getMerchantBootstrap()
			.then((data) => {
				if (this.isCurrent(revision)) {
					this.publish({ status: 'READY', data });
				}
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrent(revision)) {
					const code = error?.message;
					if (code === 'RECONNECT_REQUIRED') {
						this.publish({ status: 'RECONNECT_REQUIRED' });
						this.onConnectionAttention();
					} else if (code === 'REMOTE_UNAVAILABLE') {
						this.publish({ status: 'REMOTE_UNAVAILABLE' });
					} else {
						this.publish({ status: 'LOAD_FAILED' });
						if (
							code === 'SITE_URL_CHANGED' ||
							code === 'LOCAL_STATE_INVALID'
						) {
							this.onConnectionAttention();
						}
					}
				}
				return this.state;
			});
		const request = operation.finally(() => {
			if (this.requestPromise === request) {
				this.requestPromise = null;
			}
			if (
				!this.disposed &&
				this.connectionStatus === 'CONNECTED' &&
				this.state.status === 'IDLE'
			) {
				this.refresh();
			}
		});
		this.requestPromise = request;
		return request;
	}

	dispose() {
		this.disposed = true;
		this.revision += 1;
		this.listeners.clear();
	}

	isCurrent(revision) {
		return (
			!this.disposed &&
			this.connectionStatus === 'CONNECTED' &&
			revision === this.revision
		);
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
