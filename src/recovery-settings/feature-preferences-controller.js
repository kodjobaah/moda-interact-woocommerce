import {
	createFeaturePreferencesClient,
	parseFeaturePreferences,
} from './feature-preferences-client';

/** Effective feature state always comes from the latest confirmed snapshot. */
export class FeaturePreferencesController {
	constructor(client = createFeaturePreferencesClient()) {
		this.client = client;
		this.listeners = new Set();
		this.state = { status: 'IDLE', data: null };
		this.connectionStatus = 'LOADING';
		this.connectionIdentity = '';
		this.active = false;
		this.epoch = 0;
		this.pending = null;
		this.disposed = false;
	}

	subscribe(listener) {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	publish(state) {
		if (this.disposed) {
			return;
		}
		this.state = state;
		this.listeners.forEach((listener) => listener(state));
	}

	reset() {
		++this.epoch;
		this.pending = null;
		this.publish({ status: 'IDLE', data: null });
	}

	setConnection(connection) {
		if (this.disposed) {
			return;
		}
		const status = connection?.status ?? 'LOADING';
		const identity = `${connection?.installationId ?? ''}:${connection?.credentialVersion ?? ''}`;
		if (
			this.connectionStatus === status &&
			this.connectionIdentity === identity
		) {
			return;
		}
		this.connectionStatus = status;
		this.connectionIdentity = identity;
		this.reset();
		if (status === 'CONNECTED' && this.active) {
			this.refresh();
		}
	}

	setActive(active) {
		if (this.disposed || this.active === active) {
			return;
		}
		this.active = active;
		this.reset();
		if (active && this.connectionStatus === 'CONNECTED') {
			this.refresh();
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

	async refresh() {
		if (!this.isReady()) {
			return this.state;
		}
		if (this.pending) {
			return this.pending;
		}
		const epoch = ++this.epoch;
		this.publish({ status: 'LOADING', data: null });
		return this.perform(epoch, () => this.client.read(), 'READY');
	}

	async save(featureId, enabled) {
		if (!this.isReady() || !this.state.data) {
			return this.state;
		}
		if (this.pending) {
			return this.pending;
		}
		const snapshot = this.state.data;
		const feature = snapshot.features.find((item) => item.id === featureId);
		if (!feature?.editable || typeof enabled !== 'boolean') {
			return this.state;
		}
		if (feature.enabled === enabled) {
			return this.state;
		}
		const epoch = ++this.epoch;
		this.publish({ status: 'SAVING', data: snapshot });
		return this.perform(
			epoch,
			() =>
				this.client.save({
					expectedRevision: snapshot.revision,
					preferences: [{ featureId, enabled }],
				}),
			'SAVED'
		);
	}

	isReady() {
		return (
			!this.disposed &&
			this.active &&
			this.connectionStatus === 'CONNECTED'
		);
	}

	perform(epoch, operation, successStatus) {
		const request = Promise.resolve()
			.then(operation)
			.then(parseFeaturePreferences)
			.then((data) => {
				if (this.isCurrent(epoch)) {
					this.publish({ status: successStatus, data });
				}
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrent(epoch)) {
					const code = error?.code || error?.message;
					let status = 'ERROR';
					if (code === 'FEATURES_UNAVAILABLE') {
						status = 'UNAVAILABLE';
					} else if (code === 'DENIED' || code === 'FORBIDDEN') {
						status = 'DENIED';
					} else if (code === 'CONFLICT') {
						status = 'CONFLICT';
					}
					this.publish({ status, data: null });
				}
				return this.state;
			})
			.finally(() => {
				if (this.pending === request) {
					this.pending = null;
				}
			});
		this.pending = request;
		return request;
	}

	dispose() {
		this.disposed = true;
		++this.epoch;
		this.pending = null;
		this.listeners.clear();
	}
}
