import { createMerchantKnowledgeClient } from './knowledge-client';
import { knowledgeActionAllowed } from './knowledge-action-validation';

// Internal marker: the command succeeded, but its follow-up read did not.
const ACKNOWLEDGED_NEEDS_REFRESH = Symbol('acknowledged-needs-refresh');

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

	async refresh() {
		if (!this.active || !this.connected || this.disposed) {
			return this.state;
		}
		if (this.pending) {
			return this.pending;
		}
		const epoch = ++this.epoch;
		const previousData = this.state.data;
		this.publish({ status: 'LOADING', data: previousData });
		return this.request(
			epoch,
			(context) => this.client.read(context),
			'READY',
			previousData,
			'read'
		);
	}

	async perform(action, payload) {
		if (action === 'cancelUpload') {
			if (
				this.state.status === 'SAVING' &&
				['upload', 'replaceSource'].includes(this.state.activeAction)
			) {
				this.currentAbort?.abort();
			}
			return this.state;
		}
		if (
			!this.active ||
			!this.connected ||
			this.disposed ||
			this.pending ||
			this.state.status !== 'READY' ||
			this.state.needsRefresh
		) {
			return this.state;
		}
		const data = this.state.data;
		if (!knowledgeActionAllowed(data, this.client, action, payload)) {
			return this.state;
		}
		const epoch = ++this.epoch;
		this.publish({ status: 'SAVING', data, activeAction: action });
		let confirmed = false;
		const result = await this.request(
			epoch,
			async (context) => {
				const acknowledgement = await this.client[action](payload, {
					...context,
					snapshot: data,
					onProgress: (phase) => {
						if (this.isCurrent(epoch)) {
							this.publish({
								status: 'SAVING',
								data,
								activeAction: action,
								phase,
							});
						}
					},
				});
				if (context.signal.aborted) {
					throw Object.assign(new Error('ABORTED'), {
						code: 'ABORTED',
					});
				}
				// Acknowledged additions and uploads may reset their forms. Failed
				// or interrupted writes must retain the merchant's draft.
				confirmed = ['addUrl', 'upload', 'replaceSource'].includes(
					action
				);
				// Web-source commands return a validated authoritative snapshot.
				// An incomplete (paginated) snapshot must still be read fully.
				if (acknowledgement?.knowledge?.nextPosition === null) {
					return acknowledgement.knowledge;
				}
				try {
					return await this.client.read(context);
				} catch (error) {
					if (context.signal.aborted) {
						throw error;
					}
					// File commands return only an acknowledgement. Do not turn a
					// successful write into a reported failed write if refresh fails.
					return { [ACKNOWLEDGED_NEEDS_REFRESH]: data };
				}
			},
			'READY',
			data,
			'write'
		);
		return confirmed && this.isCurrent(epoch)
			? { ...result, confirmedAction: action }
			: result;
	}

	request(
		epoch,
		operation,
		successStatus,
		originalData = null,
		kind = 'read'
	) {
		const controller = new AbortController();
		this.currentAbort = controller;
		const request = Promise.resolve()
			.then(() => operation({ signal: controller.signal }))
			.then((data) => {
				if (this.isCurrent(epoch) && !controller.signal.aborted) {
					if (data?.[ACKNOWLEDGED_NEEDS_REFRESH]) {
						this.publish({
							status: 'READY',
							data: data[ACKNOWLEDGED_NEEDS_REFRESH],
							error: 'SAVED_NEEDS_REFRESH',
							needsRefresh: true,
						});
					} else {
						this.publish({ status: successStatus, data });
					}
				}
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrent(epoch)) {
					const code = error?.code ?? error?.message;
					if (originalData && code === 'ABORTED') {
						this.publish({ status: 'READY', data: originalData });
					} else if (originalData) {
						// A failed read keeps the last valid data but prevents stale writes.
						// A transport failure during a write has an UNKNOWN outcome:
						// refresh before allowing another submit, avoiding duplicates.
						const uncertainWrite =
							kind === 'write' &&
							[
								'KNOWLEDGE_UNAVAILABLE',
								'REMOTE_UNAVAILABLE',
								'API_NOT_CONFIGURED',
							].includes(code);
						this.publish({
							status: 'READY',
							data: originalData,
							error:
								kind === 'read'
									? 'REFRESH_FAILED'
									: uncertainWrite
										? 'VERIFY_REQUIRED'
										: code === 'CONFLICT'
											? 'CONFLICT'
											: code === 'DENIED' ||
												  code === 'FORBIDDEN'
												? 'DENIED'
												: 'ERROR',
							needsRefresh:
								kind === 'read' ||
								code === 'CONFLICT' ||
								uncertainWrite,
						});
					} else {
						const status = [
							'KNOWLEDGE_UNAVAILABLE',
							'RECONNECT_REQUIRED',
							'REMOTE_UNAVAILABLE',
							'API_NOT_CONFIGURED',
						].includes(code)
							? 'UNAVAILABLE'
							: code === 'DENIED' || code === 'FORBIDDEN'
								? 'DENIED'
								: code === 'CONFLICT'
									? 'CONFLICT'
									: 'ERROR';
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
		this.currentAbort?.abort();
		this.currentAbort = null;
		this.disposed = true;
		++this.epoch;
		this.pending = null;
		this.listeners.clear();
	}
}
