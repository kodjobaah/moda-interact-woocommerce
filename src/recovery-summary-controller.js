import { createRecoverySummaryClient } from './recovery-summary-client';

/** Read-only lifecycle; never alters the category or recovery policy. */
export class RecoverySummaryController {
	constructor(client = createRecoverySummaryClient()) {
		this.client = client;
		this.connectionStatus = 'LOADING';
		this.active = false;
		this.disposed = false;
		this.revision = 0;
		this.pending = null;
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
		if (this.disposed || status === this.connectionStatus) {
			return;
		}
		this.connectionStatus = status;
		this.revision += 1;
		this.pending = null;
		if (status !== 'CONNECTED') {
			this.publish({ status: 'IDLE', data: null });
		} else if (this.active) {
			this.refresh();
		}
	}

	setActive(active) {
		if (this.disposed || active === this.active) {
			return;
		}
		this.active = active;
		this.revision += 1;
		this.pending = null;
		if (active && this.connectionStatus === 'CONNECTED') {
			this.refresh();
		}
	}

	refresh() {
		if (
			this.disposed ||
			!this.active ||
			this.connectionStatus !== 'CONNECTED'
		) {
			return Promise.resolve(this.state);
		}
		if (this.pending) {
			return this.pending;
		}
		const revision = ++this.revision;
		this.publish({ status: 'LOADING', data: null });
		const pending = Promise.resolve()
			.then(() => this.client.read())
			.then((data) => {
				if (this.isCurrent(revision)) {
					this.publish({ status: 'READY', data });
				}
				return this.state;
			})
			.catch(() => {
				if (this.isCurrent(revision)) {
					this.publish({ status: 'ERROR', data: null });
				}
				return this.state;
			})
			.finally(() => {
				if (this.pending === pending) {
					this.pending = null;
				}
			});
		this.pending = pending;
		return pending;
	}

	isCurrent(revision) {
		return (
			!this.disposed &&
			this.active &&
			this.connectionStatus === 'CONNECTED' &&
			this.revision === revision
		);
	}

	dispose() {
		this.disposed = true;
		this.revision += 1;
		this.listeners.clear();
	}
}
