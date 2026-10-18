import {
	createMerchantKnowledgeClient,
	validKnowledgeFile,
	validKnowledgeUrl,
} from './knowledge-client';
import { sourceCapacityAvailable } from './knowledge-display';

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
		return this.request(epoch, () => this.client.read(), 'READY');
	}

	async perform(action, payload) {
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
		if (
			['addUrl', 'upload'].includes(action) &&
			(!data.planEntitled || !sourceCapacityAvailable(data))
		) {
			return this.state;
		}
		if (
			!data?.permissions?.[action] ||
			typeof this.client[action] !== 'function'
		) {
			return this.state;
		}
		if (
			action === 'addUrl' &&
			(!payload?.name?.trim() ||
				!validKnowledgeUrl(payload.url ?? '') ||
				!payload.purpose ||
				!payload.languageTag)
		) {
			return this.state;
		}
		if (
			action === 'upload' &&
			(!payload?.name?.trim() ||
				!payload.purpose ||
				!payload.languageTag ||
				!validKnowledgeFile(
					payload.file,
					data.maxUploadBytes,
					payload.dataFormatKey
				) ||
				!['CSV', 'XLSX'].includes(payload.dataFormatKey))
		) {
			return this.state;
		}
		if (
			[
				'refreshSource',
				'deleteSource',
				'moveSource',
				'editSource',
				'replaceSource',
				'reprocessSource',
			].includes(action) &&
			!data.sources?.some((source) => source.id === payload?.id)
		) {
			return this.state;
		}
		const source = data.sources?.find((item) => item.id === payload?.id);
		if (
			action === 'addUrl' &&
			!data.catalogue?.some(
				(item) =>
					item.purpose.key === payload.purpose &&
					item.dataFormat.key === 'WEB_PAGE'
			)
		) {
			return this.state;
		}
		if (
			action === 'upload' &&
			!data.catalogue?.some(
				(item) =>
					item.purpose.key === payload.purpose &&
					item.dataFormat.key === payload.dataFormatKey &&
					item.dataFormat.inputKind === 'UPLOAD'
			)
		) {
			return this.state;
		}
		if (
			['replaceSource', 'editSource'].includes(action) &&
			source?.currentlyPlanEntitled === false
		) {
			return this.state;
		}
		if (
			action === 'refreshSource' &&
			source?.dataFormatKey !== 'WEB_PAGE'
		) {
			return this.state;
		}
		if (
			action === 'reprocessSource' &&
			!['CSV', 'XLSX'].includes(source?.dataFormatKey)
		) {
			return this.state;
		}
		if (
			action === 'replaceSource' &&
			(!['CSV', 'XLSX'].includes(source?.dataFormatKey) ||
				source.dataFormatKey !== payload?.dataFormatKey ||
				source.purposeKey !== payload?.purpose)
		) {
			return this.state;
		}
		if (
			action === 'replaceSource' &&
			(!payload?.name?.trim() ||
				!payload.purpose ||
				!payload.languageTag ||
				!validKnowledgeFile(
					payload.file,
					data.maxUploadBytes,
					payload.dataFormatKey
				))
		) {
			return this.state;
		}
		if (
			action === 'editSource' &&
			(!payload?.name?.trim() ||
				!payload.languageTag ||
				(payload.url !== undefined && !validKnowledgeUrl(payload.url)))
		) {
			return this.state;
		}
		if (
			action === 'moveSource' &&
			(!Array.isArray(payload.sourceIds) ||
				payload.sourceIds.length !== data.sources.length ||
				new Set(payload.sourceIds).size !== data.sources.length ||
				payload.sourceIds.some(
					(id) =>
						!data.sources.some((candidate) => candidate.id === id)
				))
		) {
			return this.state;
		}
		if (this.pollTimer !== null) {
			clearTimeout(this.pollTimer);
		}
		this.pollTimer = null;
		const epoch = ++this.epoch;
		this.publish({ status: 'SAVING', data });
		return this.request(
			epoch,
			async () => {
				await this.client[action](payload);
				return this.client.read(); // Only server-acknowledged data becomes visible.
			},
			'READY'
		);
	}

	request(epoch, operation, successStatus) {
		const request = Promise.resolve()
			.then(operation)
			.then((data) => {
				if (this.isCurrent(epoch)) {
					this.publish({ status: successStatus, data });
					this.pollProcessing();
				}
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrent(epoch)) {
					const code = error?.code ?? error?.message;
					let status = 'ERROR';
					if (code === 'KNOWLEDGE_UNAVAILABLE') {
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
		this.stopPolling();
		this.disposed = true;
		++this.epoch;
		this.pending = null;
		this.listeners.clear();
	}
}
