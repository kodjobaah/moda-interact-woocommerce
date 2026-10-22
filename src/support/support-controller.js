import { createSupportClient } from './support-client';
import { newSupportActionId } from './support-action-id';
import { validActionId } from './support-contract';
import { validSupportBody } from './support-validation';

function initialState(readEnabled) {
	return {
		status: readEnabled ? 'IDLE' : 'UNAVAILABLE',
		items: [],
		page: 1,
		totalPages: 0,
		unread: 0,
		sendStatus: 'IDLE',
		sendBlocked: false,
		error: null,
	};
}

/** Screen-owned async state: no optimistic sends or local Support message store. */
export class SupportController {
	constructor(
		client = createSupportClient(),
		createActionId = newSupportActionId
	) {
		this.client = client;
		this.createActionId = createActionId;
		this.capabilities = client.capabilities;
		this.state = initialState(this.capabilities.read);
		this.listeners = new Set();
		this.active = false;
		this.revision = 0;
		this.session = 0;
		this.abort = null;
		this.markAbort = null;
		this.sendAbort = null;
		this.sending = false;
		this.pendingSend = null;
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
		this.session++;
		if (active) {
			if (this.capabilities.read) {
				void this.refresh();
			}
		} else {
			this.revision++;
			this.abort?.abort();
			this.markAbort?.abort();
			this.sendAbort?.abort();
			this.abort = null;
			this.markAbort = null;
			this.sendAbort = null;
			this.pendingSend = null;
			this.sending = false;
			this.reading.clear();
			this.publish(initialState(this.capabilities.read));
		}
	}

	async refresh(page = this.state.page) {
		if (
			!this.active ||
			!this.capabilities.read ||
			!this.client.list ||
			this.state.status === 'DENIED' ||
			this.state.status === 'UNAVAILABLE'
		) {
			return false;
		}
		if (!Number.isSafeInteger(page) || page < 1 || page > 999999) {
			return false;
		}
		const revision = ++this.revision;
		this.abort?.abort();
		this.markAbort?.abort();
		this.reading.clear();
		const request = new AbortController();
		this.abort = request;
		this.markAbort = new AbortController();
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
				result.page !== page ||
				!Number.isSafeInteger(result?.totalPages) ||
				result.totalPages < 1 ||
				result.page > result.totalPages ||
				!Number.isSafeInteger(result?.unread) ||
				result.unread < 0
			) {
				throw new Error('remote_response_invalid');
			}
			this.publish({
				...this.state,
				status: 'READY',
				items: result.items,
				page: result.page,
				totalPages: result.totalPages,
				unread: result.unread,
				error: null,
			});
			void this.markUnread(revision, result.items, this.markAbort.signal);
			return true;
		} catch (error) {
			if (this.active && revision === this.revision) {
				let status = 'ERROR';
				let reason = 'read_failed';
				if (error?.code === 'forbidden') {
					status = 'DENIED';
					reason = 'permission_denied';
				} else if (error?.code === 'connection_unavailable') {
					status = 'UNAVAILABLE';
					reason = 'connection_unavailable';
				}
				this.publish({
					...this.state,
					status,
					items: [],
					unread: 0,
					error: reason,
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
			!Number.isSafeInteger(page) ||
			page === this.state.page ||
			page < 1 ||
			page > this.state.totalPages
		) {
			return false;
		}
		return this.refresh(page);
	}

	async markUnread(revision, items, signal) {
		if (!this.capabilities.markRead || !this.client.markRead) {
			return;
		}
		for (const message of items) {
			if (!this.active || this.revision !== revision || signal.aborted) {
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
				const receipt = await this.client.markRead(message.id, signal);
				if (
					receipt?.schemaVersion === 1 &&
					receipt.messageId === message.id &&
					typeof receipt.readAt === 'string' &&
					this.active &&
					this.revision === revision &&
					!signal.aborted
				) {
					this.publish({
						...this.state,
						unread: Math.max(0, this.state.unread - 1),
						items: this.state.items.map((item) =>
							item.id === message.id
								? { ...item, readAt: receipt.readAt }
								: item
						),
					});
				}
			} catch (error) {
				// A failed mark is still unread; never claim a local acknowledgment.
				if (
					error?.code === 'forbidden' ||
					error?.code === 'connection_unavailable'
				) {
					this.blockSession(error);
					return;
				}
			} finally {
				this.reading.delete(message.id);
			}
		}
	}

	blockSession(error) {
		if (!this.active) {
			return;
		}
		this.revision++;
		this.abort?.abort();
		this.markAbort?.abort();
		this.sendAbort?.abort();
		this.publish({
			...this.state,
			status: error?.code === 'forbidden' ? 'DENIED' : 'UNAVAILABLE',
			items: [],
			unread: 0,
			sendStatus: 'ERROR',
		});
	}

	async send(body) {
		if (
			!this.active ||
			!this.capabilities.send ||
			!this.client.send ||
			this.sending ||
			this.state.sendBlocked ||
			this.state.status !== 'READY'
		) {
			return false;
		}
		if (!validSupportBody(body)) {
			this.publish({ ...this.state, sendStatus: 'INVALID' });
			return false;
		}
		let pending = this.pendingSend;
		if (!pending || pending.body !== body) {
			try {
				const actionId = this.createActionId();
				if (!validActionId(actionId)) {
					throw new Error('invalid_action_id');
				}
				pending = { body, actionId };
			} catch {
				this.publish({ ...this.state, sendStatus: 'ERROR' });
				return false;
			}
			this.pendingSend = pending;
		}
		this.sending = true;
		const session = this.session;
		const request = new AbortController();
		this.sendAbort = request;
		this.publish({ ...this.state, sendStatus: 'SENDING' });
		try {
			const response = await this.client.send(
				body,
				pending.actionId,
				request.signal
			);
			if (
				!this.active ||
				this.session !== session ||
				request.signal.aborted
			) {
				return false;
			}
			if (
				response?.schemaVersion !== 1 ||
				typeof response.messageId !== 'string' ||
				!response.messageId
			) {
				throw new Error('remote_response_invalid');
			}
			this.pendingSend = null;
			this.publish({ ...this.state, sendStatus: 'SENT' });
			void this.refresh();
			return true;
		} catch (error) {
			if (
				this.active &&
				this.session === session &&
				!request.signal.aborted
			) {
				if (
					['invalid_request', 'idempotency_conflict'].includes(
						error?.code
					)
				) {
					this.pendingSend = null;
				}
				if (
					['forbidden', 'connection_unavailable'].includes(
						error?.code
					)
				) {
					this.blockSession(error);
				} else if (error?.code === 'send_unavailable') {
					// Suspended Shop may still read Support; only compose is blocked.
					this.publish({
						...this.state,
						sendBlocked: true,
						sendStatus: 'ERROR',
					});
				} else {
					this.publish({ ...this.state, sendStatus: 'ERROR' });
				}
			}
			return false;
		} finally {
			if (this.sendAbort === request) {
				this.sendAbort = null;
				this.sending = false;
			}
		}
	}
}
