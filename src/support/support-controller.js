import { createSupportClient } from './support-client';
import { validSupportBody } from './support-validation';

function initialState(readEnabled) {
	return {
		status: readEnabled ? 'IDLE' : 'UNAVAILABLE',
		items: [],
		page: 1,
		totalPages: 0,
		sendStatus: 'IDLE',
		error: null,
	};
}

/** Independent per-screen state; network clients are test-injectable, never guessed. */
export class SupportController {
	constructor(client = createSupportClient()) {
		this.client = client;
		this.capabilities = client.capabilities;
		this.state = initialState(this.capabilities.read);
		this.listeners = new Set();
		this.active = false;
		this.revision = 0;
		this.abort = null;
		this.sending = false;
		this.reading = new Set();
	}

	subscribe(listener) {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	publish(next) {
		this.state = next;
		for (const listener of this.listeners) {
			listener(next);
		}
	}

	setActive(active) {
		if (this.active === active) {
			return;
		}
		this.active = active;
		if (active) {
			if (this.capabilities.read) {
				void this.refresh();
			}
		} else {
			this.revision++;
			this.abort?.abort();
			this.abort = null;
			this.reading.clear();
			this.publish(initialState(this.capabilities.read));
		}
	}

	async refresh(page = this.state.page) {
		if (!this.active || !this.capabilities.read || !this.client.list) {
			return false;
		}
		if (!Number.isSafeInteger(page) || page < 1) {
			return false;
		}
		const revision = ++this.revision;
		this.abort?.abort();
		const request = new AbortController();
		this.abort = request;
		this.publish({ ...this.state, status: 'LOADING', error: null });
		try {
			const result = await this.client.list(
				{ page, pageSize: 25 },
				request.signal
			);
			if (!this.active || revision !== this.revision) {
				return false;
			}
			if (
				!Array.isArray(result?.items) ||
				!Number.isSafeInteger(result?.page) ||
				result.page < 1 ||
				!Number.isSafeInteger(result?.totalPages) ||
				result.totalPages < 0 ||
				(result.totalPages > 0 && result.page > result.totalPages)
			) {
				throw new Error('Invalid support response');
			}
			this.publish({
				...this.state,
				status: 'READY',
				items: result.items,
				page: result.page,
				totalPages: result.totalPages,
				error: null,
			});
			this.markUnread(revision, result.items);
			return true;
		} catch (error) {
			if (this.active && revision === this.revision) {
				const denied =
					error?.code === 'forbidden' || error?.status === 403;
				this.publish({
					...this.state,
					status: denied ? 'DENIED' : 'ERROR',
					items: [],
					error: denied ? 'permission_denied' : 'read_failed',
				});
			}
			return false;
		} finally {
			if (revision === this.revision) {
				this.abort = null;
			}
		}
	}

	goToPage(page) {
		if (
			this.state.status !== 'READY' ||
			page === this.state.page ||
			page < 1 ||
			page > this.state.totalPages
		) {
			return false;
		}
		return this.refresh(page);
	}

	async markUnread(revision, items) {
		if (!this.capabilities.markRead || !this.client.markRead) {
			return;
		}
		for (const message of items) {
			if (!this.active || this.revision !== revision) {
				return;
			}
			if (
				!['ADMINISTRATIVE', 'SYSTEM'].includes(message.kind) ||
				message.state !== 'AVAILABLE' ||
				message.readAt ||
				this.reading.has(message.id)
			) {
				continue;
			}
			this.reading.add(message.id);
			try {
				const marked = await this.client.markRead(message.id);
				if (
					marked === true &&
					this.active &&
					revision === this.revision
				) {
					this.publish({
						...this.state,
						items: this.state.items.map((item) =>
							item.id === message.id
								? { ...item, readAt: new Date().toISOString() }
								: item
						),
					});
				}
			} catch {
				// Do not claim read acknowledgement when the service has not confirmed it.
			} finally {
				this.reading.delete(message.id);
			}
		}
	}

	async send(body) {
		if (
			!this.active ||
			!this.capabilities.send ||
			!this.client.send ||
			this.sending
		) {
			return false;
		}
		if (!validSupportBody(body)) {
			this.publish({ ...this.state, sendStatus: 'INVALID' });
			return false;
		}
		this.sending = true;
		const revision = this.revision;
		this.publish({ ...this.state, sendStatus: 'SENDING' });
		try {
			const response = await this.client.send(body);
			if (!this.active || this.revision !== revision) {
				return false;
			}
			if (response?.sent !== true) {
				throw new Error('Unconfirmed send');
			}
			this.publish({ ...this.state, sendStatus: 'SENT' });
			void this.refresh();
			return true;
		} catch {
			if (this.active && revision === this.revision) {
				this.publish({ ...this.state, sendStatus: 'ERROR' });
			}
			return false;
		} finally {
			this.sending = false;
		}
	}
}
