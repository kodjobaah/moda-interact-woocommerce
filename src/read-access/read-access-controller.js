import { createReadAccessClient } from './read-access-client';

const INITIAL = Object.freeze({
	status: 'IDLE',
	grantStatus: 'NOT_CONNECTED',
	providerRevocationRequired: false,
	approvalNotCompleted: false,
	pendingAction: null,
	authorizationUrl: null,
});

/** One connection generation, one in-flight command, and no persisted bearer URL. */
export class ReadAccessController {
	constructor(client = createReadAccessClient()) {
		this.client = client;
		this.state = { ...INITIAL };
		this.listeners = new Set();
		this.identity = null;
		this.siteUrl = null;
		this.revision = 0;
		this.actionPromise = null;
		this.readPromise = null;
		this.disposed = false;
	}

	subscribe(listener) {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	setConnection(connection) {
		const connected = connection?.status === 'CONNECTED';
		const identity = connected
			? `${connection.installationId}:${connection.credentialVersion}:${connection.shopId}`
			: null;
		if (this.identity === identity || this.disposed) return;
		this.identity = identity;
		this.siteUrl = connected ? connection.canonicalSiteUrl : null;
		this.revision += 1;
		// Detach stale promises from the previous installation generation.
		this.readPromise = null;
		this.actionPromise = null;
		this.publish({ ...INITIAL });
		if (connected) this.refresh();
	}

	refresh() {
		if (this.disposed || !this.identity || this.actionPromise || this.readPromise) {
			return this.readPromise ?? this.actionPromise ?? Promise.resolve(this.state);
		}
		const revision = ++this.revision;
		this.publish({ ...this.state, status: this.state.status === 'IDLE' ? 'LOADING' : this.state.status });
		const operation = this.client.getStatus().then((grant) => {
			if (this.isCurrent(revision)) {
				this.publish({
					...this.state,
					...grant,
					approvalNotCompleted: grant.grantStatus === 'NOT_CONNECTED' && (this.state.grantStatus === 'PENDING' || this.state.approvalNotCompleted),
					status: 'READY',
					authorizationUrl: grant.grantStatus === 'PENDING' ? this.state.authorizationUrl : null,
				});
			}
			return this.state;
		}).catch(() => {
			if (this.isCurrent(revision)) this.publish({ ...this.state, status: 'ERROR', authorizationUrl: null });
			return this.state;
		}).finally(() => {
			if (this.readPromise === operation) this.readPromise = null;
		});
		this.readPromise = operation;
		return operation;
	}

	start() {
		if (this.disposed || !this.identity || this.actionPromise || this.readPromise ||
			this.state.grantStatus === 'CONNECTED') return this.actionPromise ?? Promise.resolve(this.state);
		const revision = ++this.revision;
		this.publish({ ...this.state, pendingAction: 'start', authorizationUrl: null });
		const operation = this.client.start(this.siteUrl).then((authorizationUrl) => {
			if (this.isCurrent(revision)) this.publish({
				...this.state, grantStatus: 'PENDING', status: 'READY', approvalNotCompleted: false,
				pendingAction: null, authorizationUrl,
			});
			return this.state;
		}).catch(() => {
			if (this.isCurrent(revision)) this.publish({ ...this.state, status: 'ERROR', pendingAction: null });
			return this.state;
		}).finally(() => {
			if (this.actionPromise === operation) this.actionPromise = null;
		});
		this.actionPromise = operation;
		return operation;
	}

	revoke() {
		if (this.disposed || !this.identity || this.actionPromise || this.readPromise ||
			this.state.grantStatus !== 'CONNECTED') return this.actionPromise ?? Promise.resolve(this.state);
		const revision = ++this.revision;
		this.publish({ ...this.state, pendingAction: 'revoke', authorizationUrl: null });
		const operation = this.client.revoke().then((grant) => {
			if (this.isCurrent(revision)) this.publish({ ...INITIAL, ...grant, status: 'READY' });
			return this.state;
		}).catch(() => {
			if (this.isCurrent(revision)) this.publish({ ...this.state, status: 'ERROR', pendingAction: null });
			return this.state;
		}).finally(() => {
			if (this.actionPromise === operation) this.actionPromise = null;
		});
		this.actionPromise = operation;
		return operation;
	}

	isCurrent(revision) {
		return !this.disposed && revision === this.revision;
	}

	publish(state) {
		if (this.disposed) return;
		this.state = state;
		for (const listener of this.listeners) listener(state);
	}

	dispose() {
		this.disposed = true;
		this.revision += 1;
		this.listeners.clear();
	}
}
