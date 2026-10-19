import { createMerchantKnowledgeClient } from './knowledge-client';
import { knowledgeActionAllowed } from './knowledge-action-validation';

// Bounded, connection-aware state owner; no provider operations in React.
export class MerchantKnowledgeController {
	constructor(client = createMerchantKnowledgeClient()) {
		this.client = client;
		this.state = { status: 'IDLE', data: null };
		this.listeners = new Set();
		this.identity = '';
		this.connected = false;
		this.active = false;
		this.disposed = false;
		this.epoch = 0;
		this.pending = null;
		this.currentAbort = null;
		this.pollTimer = null;
		this.pollUntil = null;
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

	setConnection(connection) {
		if (this.disposed) {
			return;
		}
		const connected = connection?.status === 'CONNECTED';
		const identity = connected
			? `${connection.installationId ?? ''}:${connection.credentialVersion ?? ''}`
			: '';
		if (this.connected === connected && this.identity === identity) {
			return;
		}
		this.connected = connected;
		this.identity = identity;
		this.invalidate();
		if (connected && this.active) {
			void this.refresh();
		}
	}

	setActive(active) {
		if (this.disposed || this.active === active) {
			return;
		}
		this.active = active;
		this.invalidate();
		if (active && this.connected) {
			void this.refresh();
		}
	}

	invalidate() {
		this.currentAbort?.abort();
		this.currentAbort = null;
		this.stopPolling();
		++this.epoch;
		this.pending = null;
		this.publish({ status: 'IDLE', data: null });
	}

	isCurrent(epoch) {
		return (
			!this.disposed &&
			this.active &&
			this.connected &&
			epoch === this.epoch
		);
	}

	stopPolling() {
		if (this.pollTimer !== null) {
			clearTimeout(this.pollTimer);
		}
		this.pollTimer = null;
		this.pollUntil = null;
	}

	pollProcessing() {
		if (this.pollTimer !== null) {
			clearTimeout(this.pollTimer);
		}
		this.pollTimer = null;
		const processing = this.state.data?.sources?.some(
			(source) =>
				source.processingEligible &&
				['PENDING', 'PROCESSING'].includes(source.revision?.status)
		);
		if (
			!this.active ||
			!this.connected ||
			this.disposed ||
			this.state.status !== 'READY' ||
			!processing
		) {
			this.pollUntil = null;
			return;
		}
		if (this.pollUntil === null) {
			this.pollUntil = Date.now() + 60_000;
		}
		if (Date.now() >= this.pollUntil) {
			return;
		}
		const epoch = this.epoch;
		this.pollTimer = setTimeout(() => {
			this.pollTimer = null;
			if (!this.isCurrent(epoch)) {
				return;
			}
			if (
				typeof document !== 'undefined' &&
				document.visibilityState === 'hidden'
			) {
				this.pollProcessing();
			} else {
				void this.refresh();
			}
		}, 4_000);
	}

	async refresh() {
		if (!this.active || !this.connected || this.disposed) {
			return this.state;
		}
		if (this.pending) {
			return this.pending;
		}
		if (this.pollTimer !== null) {
			clearTimeout(this.pollTimer);
		}
		this.pollTimer = null;
		const epoch = ++this.epoch;
		this.publish({ status: 'LOADING', data: this.state.data });
		return this.request(epoch, (context) => this.client.read(context), 'READY');
	}

	async perform(action, payload) {
		if (action === 'cancelUpload') {
			if (this.state.status === 'SAVING' &&
				['upload', 'replaceSource'].includes(this.state.activeAction)) {
				this.currentAbort?.abort();
			}
			return this.state;
		}
		if (
			!this.active ||
			!this.connected ||
			this.disposed ||
			this.pending ||
			this.state.status !== 'READY'
		) {
			return this.state;
		}
		const data = this.state.data;
		if (!knowledgeActionAllowed(data, this.client, action, payload)) {
			return this.state;
		}
		if (this.pollTimer !== null) {
			clearTimeout(this.pollTimer);
		}
		this.pollTimer = null;
		const epoch = ++this.epoch;
		this.publish({ status: 'SAVING', data, activeAction: action });
		return this.request(
			epoch,
			async (context) => {
				await this.client[action](payload, {
					...context, snapshot: data,
					onProgress: (phase) => {
						if (this.isCurrent(epoch)) {
							this.publish({ status: 'SAVING', data, activeAction: action, phase });
						}
					},
				});
				if (context.signal.aborted) {
					throw Object.assign(new Error('ABORTED'), { code: 'ABORTED' });
				}
				return this.client.read(context); // Only server-acknowledged data becomes visible.
			},
			'READY', data
		);
	}

	request(epoch, operation, successStatus, originalData = null) {
		const controller = new AbortController();
		this.currentAbort = controller;
		const request = Promise.resolve()
			.then(() => operation({ signal: controller.signal }))
			.then((data) => {
				if (this.isCurrent(epoch) && !controller.signal.aborted) {
					this.publish({ status: successStatus, data });
					this.pollProcessing();
				}
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrent(epoch)) {
					const code = error?.code ?? error?.message;
					if (originalData && code === 'ABORTED') {
						this.publish({ status: 'READY', data: originalData });
					} else if (originalData) {
						// Keep edit/upload forms mounted with their unsaved drafts.
						// A conflict freezes further writes until a fresh read.
						this.publish({
							status: 'READY', data: originalData,
							error: code === 'CONFLICT' ? 'CONFLICT' :
								code === 'DENIED' || code === 'FORBIDDEN' ? 'DENIED' : 'ERROR',
							needsRefresh: code === 'CONFLICT',
						});
					} else {
						const status = ['KNOWLEDGE_UNAVAILABLE', 'RECONNECT_REQUIRED',
							'REMOTE_UNAVAILABLE', 'API_NOT_CONFIGURED'].includes(code) ? 'UNAVAILABLE' :
							code === 'DENIED' || code === 'FORBIDDEN' ? 'DENIED' :
							code === 'CONFLICT' ? 'CONFLICT' : 'ERROR';
						this.publish({ status, data: null });
					}
				}
				return this.state;
			})
			.finally(() => {
				if (this.currentAbort === controller) {
					this.currentAbort = null;
				}
				if (this.pending === request) {
					this.pending = null;
				}
			});
		this.pending = request;
		return request;
	}

	dispose() {
		this.stopPolling();
		this.currentAbort?.abort();
		this.currentAbort = null;
		this.disposed = true;
		++this.epoch;
		this.pending = null;
		this.listeners.clear();
	}
}
