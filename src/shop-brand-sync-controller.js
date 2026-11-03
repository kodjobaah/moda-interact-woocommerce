import { createShopBrandSyncClient } from './shop-brand-sync-client';

const initial = () => ({ status: 'IDLE', data: null, commandPending: false, error: null });

export class ShopBrandSyncController {
	constructor(client = createShopBrandSyncClient()) {
		this.client = client;
		this.listeners = new Set();
		this.state = initial();
		this.connectionStatus = 'LOADING';
		this.connectionIdentity = '';
		this.active = false;
		this.epoch = 0;
		this.pending = null;
		this.pendingKind = null;
		this.abortController = null;
		this.timer = null;
		this.disposed = false;
	}

	subscribe(listener) {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	publish(state) {
		if (this.disposed) return;
		this.state = state;
		this.listeners.forEach((listener) => listener(state));
	}

	cancel() {
		++this.epoch;
		if (this.timer !== null) globalThis.clearTimeout?.(this.timer);
		this.timer = null;
		this.abortController?.abort();
		this.abortController = null;
		this.pending = null;
		this.pendingKind = null;
	}

	reset() {
		this.cancel();
		this.publish(initial());
	}

	setConnection(connection) {
		if (this.disposed) return;
		const status = connection?.status ?? 'LOADING';
		const identity = `${connection?.installationId ?? ''}:${connection?.credentialVersion ?? ''}`;
		if (status === this.connectionStatus && identity === this.connectionIdentity) return;
		this.connectionStatus = status;
		this.connectionIdentity = identity;
		this.reset();
		if (status === 'CONNECTED' && this.active) this.refresh();
	}

	setActive(active) {
		if (this.disposed || this.active === active) return;
		this.active = active;
		this.reset();
		if (active && this.connectionStatus === 'CONNECTED') this.refresh();
	}

	isReady() {
		return !this.disposed && this.active && this.connectionStatus === 'CONNECTED';
	}

	isCurrent(epoch) {
		return this.isReady() && this.epoch === epoch;
	}

	async refresh() {
		if (!this.isReady()) return this.state;
		if (this.pending) return this.pending;
		const epoch = ++this.epoch;
		this.abortController = new AbortController();
		this.publish({ ...this.state, status: 'LOADING', error: null });
		return this.perform(epoch, () => this.client.read({ signal: this.abortController.signal }), false);
	}

	async sync() {
		if (!this.isReady() || this.state.commandPending || ['QUEUED', 'RETRYING'].includes(this.state.data?.status)) return this.state;
		if (this.pendingKind === 'sync' && this.pending) return this.pending;
		// Preserve a click during the initial status read or an explicit refresh.
		// Wait for the read to settle, then enqueue the command if still eligible.
		while (this.pending && this.pendingKind === 'read') {
			const statusRead = this.pending;
			await statusRead;
			if (!this.isReady()) return this.state;
			if (this.pending === statusRead && this.pendingKind === 'read') continue;
		}
		if (!this.isReady() || this.state.commandPending || ['QUEUED', 'RETRYING'].includes(this.state.data?.status)) return this.state;
		if (this.pending) return this.pending;
		const epoch = ++this.epoch;
		this.abortController = new AbortController();
		this.publish({ ...this.state, status: 'REQUESTING', commandPending: true, error: null });
		const request = (async () => {
			try {
				await this.client.requestSync({ signal: this.abortController.signal });
				if (!this.isCurrent(epoch)) return this.state;
				this.publish({ ...this.state, status: 'QUEUED', commandPending: false, data: { ...(this.state.data ?? {}), status: 'QUEUED' } });
				for (let check = 0; check < 6; check++) {
					if (!(await this.wait(epoch))) return this.state;
					const data = await this.client.read({ signal: this.abortController.signal });
					if (!this.isCurrent(epoch)) return this.state;
					this.publish({ ...this.state, status: 'READY', data, commandPending: false, error: null });
					if (!['QUEUED', 'RETRYING'].includes(data.status)) break;
				}
			} catch (error) {
				if (this.isCurrent(epoch)) this.publish({ ...this.state, status: 'ERROR', commandPending: false, error: error?.code ?? error?.message ?? 'SYNC_UNAVAILABLE' });
			}
			return this.state;
		})().finally(() => {
			if (this.pending === request) {
				this.pending = null;
				this.pendingKind = null;
			}
			if (this.epoch === epoch) this.abortController = null;
		});
		this.pending = request;
		this.pendingKind = 'sync';
		return request;
	}

	wait(epoch) {
		return new Promise((resolve) => {
			if (!this.isCurrent(epoch)) return resolve(false);
			this.timer = globalThis.setTimeout?.(() => { this.timer = null; resolve(this.isCurrent(epoch)); }, 4000);
			this.abortController?.signal.addEventListener('abort', () => resolve(false), { once: true });
		});
	}

	perform(epoch, operation, poll) {
		const request = Promise.resolve().then(operation).then((data) => {
			if (this.isCurrent(epoch)) this.publish({ ...this.state, status: 'READY', data, error: null });
			return this.state;
		}).catch((error) => {
			if (this.isCurrent(epoch)) this.publish({ ...this.state, status: 'ERROR', error: error?.code ?? error?.message ?? 'SYNC_STATUS_UNAVAILABLE' });
			return this.state;
		}).finally(() => {
			if (this.pending === request) {
				this.pending = null;
				this.pendingKind = null;
			}
			if (this.epoch === epoch) this.abortController = null;
		});
		this.pending = request;
		this.pendingKind = 'read';
		return request;
	}

	dispose() {
		if (this.disposed) return;
		this.cancel();
		this.disposed = true;
		// A client promise may ignore AbortSignal and settle after unmount. Keep
		// the inspectable controller state in sync even though it can no longer publish.
		this.state = initial();
		this.listeners.clear();
	}
}
