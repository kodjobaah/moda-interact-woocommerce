import { createRecoveryDetailClient } from './api/recovery-detail-client';
import { validRecoveryId } from './api/recovery-detail-contract';

function sectionState() {
	return { status: 'IDLE', data: null, error: null };
}

/** Summary admission plus independently cancellable message/related pagination. */
export class RecoveryDetailController {
	constructor(id, client = createRecoveryDetailClient()) {
		this.id = id;
		this.client = client;
		this.active = false;
		this.listeners = new Set();
		this.state = {
			summary: sectionState(),
			messages: sectionState(),
			related: sectionState(),
		};
		this.pending = {};
		this.revisions = { summary: 0, messages: 0, related: 0 };
		this.navigation = { messages: null, related: null };
	}

	subscribe(listener) {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	publish(section, next) {
		this.state = { ...this.state, [section]: next };
		for (const listener of this.listeners) {
			listener(this.state);
		}
	}

	invalidate(section) {
		this.revisions[section] += 1;
		this.pending[section]?.abort();
		delete this.pending[section];
	}

	setActive(active) {
		if (this.active === active) {
			return;
		}
		this.active = active;
		if (active) {
			if (!validRecoveryId(this.id)) {
				this.publish('summary', {
					status: 'NOT_FOUND',
					data: null,
					error: null,
				});
			} else {
				void this.loadSummary();
			}
		} else {
			for (const section of ['summary', 'messages', 'related']) {
				this.invalidate(section);
			}
			this.navigation = { messages: null, related: null };
			this.state = {
				summary: sectionState(),
				messages: sectionState(),
				related: sectionState(),
			};
		}
	}

	async load(section, call, navigation = null) {
		if (!this.active) {
			return;
		}
		this.invalidate(section);
		const revision = this.revisions[section];
		const request = new AbortController();
		this.pending[section] = request;
		this.publish(section, {
			status: 'LOADING',
			data: this.state[section].data,
			error: null,
		});
		try {
			const data = await call(request.signal);
			if (!this.active || revision !== this.revisions[section]) {
				return;
			}
			if (section !== 'summary') {
				this.navigation[section] = navigation;
			}
			this.publish(section, { status: 'READY', data, error: null });
			if (
				section === 'summary' &&
				this.state.messages.status === 'IDLE'
			) {
				void this.loadMessages(null);
				void this.loadRelated(null);
			}
		} catch (error) {
			if (!this.active || revision !== this.revisions[section]) {
				return;
			}
			const notFound = error?.message === 'not_found';
			this.publish(section, {
				status: notFound ? 'NOT_FOUND' : 'ERROR',
				data: null,
				error: notFound ? null : 'unavailable',
			});
		} finally {
			if (revision === this.revisions[section]) {
				delete this.pending[section];
			}
		}
	}

	loadSummary() {
		return this.load('summary', (signal) =>
			this.client.summary(this.id, signal)
		);
	}

	loadMessages(navigation = this.navigation.messages) {
		if (this.state.summary.status !== 'READY') {
			return;
		}
		return this.load(
			'messages',
			(signal) => this.client.messages(this.id, navigation, signal),
			navigation
		);
	}

	loadRelated(navigation = this.navigation.related) {
		if (this.state.summary.status !== 'READY') {
			return;
		}
		return this.load(
			'related',
			(signal) => this.client.related(this.id, navigation, signal),
			navigation
		);
	}

	goMessages(direction) {
		const current = this.state.messages;
		const key = direction === 'previous' ? 'previousCursor' : 'nextCursor';
		if (current.status !== 'READY' || !current.data?.[key]) {
			return;
		}
		return this.loadMessages({ cursor: current.data[key] });
	}

	goRelated(direction) {
		const current = this.state.related;
		const key = direction === 'previous' ? 'previousCursor' : 'nextCursor';
		if (current.status !== 'READY' || !current.data?.[key]) {
			return;
		}
		return this.loadRelated({ cursor: current.data[key] });
	}

	jumpLatest() {
		// A command may settle while an earlier transcript refresh is still loading.
		// Supersede that request so the terminal outcome is not missed.
		if (this.state.summary.status !== 'READY') {
			return;
		}
		return this.loadMessages({ window: 'latest' });
	}
}
