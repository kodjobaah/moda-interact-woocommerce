import {
	createRecoveryPolicyClient,
	makeRecoveryPolicyUpdate,
} from './recovery-policy-client';

/** Manages API-002 reads, manual saves, revision conflicts and connection changes. */
export class RecoveryPolicyController {
	constructor(client = createRecoveryPolicyClient(), onSaved = () => {}) {
		this.client = client;
		this.onSaved = onSaved;
		this.connectionStatus = 'LOADING';
		this.active = false;
		this.disposed = false;
		this.epoch = 0;
		this.pendingRead = null;
		this.pendingSave = null;
		this.listeners = new Set();
		this.state = { status: 'IDLE', data: null };
	}

	subscribe(listener) {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	publish(next) {
		if (this.disposed) {
			return;
		}
		this.state = next;
		for (const listener of this.listeners) {
			listener(next);
		}
	}

	setConnectionStatus(status) {
		if (this.disposed || this.connectionStatus === status) {
			return;
		}
		this.connectionStatus = status;
		this.epoch += 1;
		this.pendingRead = null;
		this.pendingSave = null;
		if (status !== 'CONNECTED') {
			this.publish({ status: 'IDLE', data: null });
		} else if (this.active) {
			this.refresh();
		}
	}

	setActive(active) {
		if (this.disposed || this.active === active) {
			return;
		}
		this.active = active;
		this.epoch += 1;
		this.pendingRead = null;
		this.pendingSave = null;
		if (active && this.connectionStatus === 'CONNECTED') {
			this.refresh();
		} else if (!active) {
			this.publish({ status: 'IDLE', data: null });
		}
	}

	isCurrent(epoch) {
		return (
			!this.disposed &&
			this.active &&
			this.connectionStatus === 'CONNECTED' &&
			this.epoch === epoch
		);
	}

	refresh() {
		if (
			!this.active ||
			this.connectionStatus !== 'CONNECTED' ||
			this.disposed
		) {
			return Promise.resolve(this.state);
		}
		if (this.pendingSave) {
			return this.pendingSave;
		}
		if (this.pendingRead) {
			return this.pendingRead;
		}
		const epoch = ++this.epoch;
		this.publish({ status: 'LOADING', data: this.state.data });
		const request = Promise.resolve()
			.then(() => this.client.read())
			.then((data) => {
				if (this.isCurrent(epoch)) {
					this.publish({ status: 'READY', data });
				}
				return this.state;
			})
			.catch(() => {
				if (this.isCurrent(epoch)) {
					this.publish({ status: 'ERROR', data: null });
				}
				return this.state;
			})
			.finally(() => {
				if (this.pendingRead === request) {
					this.pendingRead = null;
				}
			});
		this.pendingRead = request;
		return request;
	}

	/** @param {Object} draft Values provided only after the merchant clicks Save. */
	save(draft) {
		if (this.pendingSave) {
			return this.pendingSave;
		}
		if (
			!this.active ||
			this.disposed ||
			this.connectionStatus !== 'CONNECTED' ||
			!this.state.data ||
			!['READY', 'SAVED', 'SAVE_FAILED'].includes(this.state.status)
		) {
			return Promise.resolve(this.state);
		}
		let update;
		try {
			update = makeRecoveryPolicyUpdate(this.state.data, draft);
		} catch (error) {
			this.publish({ status: error.message, data: this.state.data });
			return Promise.resolve(this.state);
		}
		const epoch = ++this.epoch;
		const oldData = this.state.data;
		this.publish({ status: 'SAVING', data: oldData });
		const request = Promise.resolve()
			.then(() => this.client.save(update))
			.then((data) => {
				if (this.isCurrent(epoch)) {
					this.publish({ status: 'SAVED', data });
					this.onSaved();
				}
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrent(epoch)) {
					let status = 'SAVE_FAILED';
					if (error.message === 'POLICY_CONFLICT') {
						status = 'CONFLICT';
					}
					if (error.message === 'OFFER_UNSUPPORTED') {
						status = 'OFFER_UNSUPPORTED';
					}
					if (
						['RECONNECT_REQUIRED', 'SITE_URL_CHANGED'].includes(
							error.message
						)
					) {
						status = 'RECONNECT_REQUIRED';
					}
					this.publish({ status, data: oldData });
				}
				return this.state;
			})
			.finally(() => {
				if (this.pendingSave === request) {
					this.pendingSave = null;
				}
			});
		this.pendingSave = request;
		return request;
	}

	dispose() {
		this.disposed = true;
		this.epoch += 1;
		this.listeners.clear();
	}
}
