import { createSelectionClient } from './selection-client';
import { isCanonicalPhone, isTicketReference } from './selection-contract';

/** State and serialisation stay outside the React view; no phone is persisted. */
export class SelectionController {
	constructor(client = createSelectionClient()) {
		this.client = client;
		this.listeners = new Set();
		this.active = false;
		this.busy = false;
		this.sequence = 0;
		this.state = { phase: 'IDLE', phone: null, record: null, error: null, outcome: null };
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	setActive(active) {
		this.active = active;
		if (!active) {
			this.sequence++;
			this.busy = false;
			this.setState({ phase: 'IDLE', phone: null, record: null, error: null, outcome: null });
		}
	}

	setState(next) {
		this.state = next;
		for (const callback of this.listeners) callback(next);
	}

	async lookup(phone) {
		if (!this.active || this.busy) return false;
		if (!isCanonicalPhone(phone)) {
			this.setState({ phase: 'ERROR', phone: null, record: null, error: 'INVALID_REQUEST', outcome: null });
			return false;
		}
		this.busy = true;
		const sequence = ++this.sequence;
		this.setState({ phase: 'LOADING', phone: null, record: null, error: null, outcome: null });
		try {
			const record = await this.client.lookup(phone);
			if (this.active && sequence === this.sequence) {
				this.setState({ phase: 'READY', phone, record, error: null, outcome: null });
			}
			return true;
		} catch (error) {
			if (this.active && sequence === this.sequence) {
				this.setState({ phase: 'ERROR', phone: null, record: null, error: error.message, outcome: null });
			}
			return false;
		} finally { if (sequence === this.sequence) this.busy = false; }
	}

	async command(action, evidenceReference = null) {
		const { phone, record, phase } = this.state;
		if (!this.active || this.busy || phase !== 'READY' || !record) return false;
		if (action === 'REENABLE' && !record.canReenable) return false;
		if (action === 'SUPPRESS' && record.suppressed) return false;
		if (action === 'RECORD_CUSTOMER_STOP' && (
			record.suppressionReason === 'CUSTOMER_STOP' || !isTicketReference(evidenceReference)
		)) return false;
		if (!['SUPPRESS', 'REENABLE', 'RECORD_CUSTOMER_STOP'].includes(action)) return false;
		this.busy = true;
		const sequence = ++this.sequence;
		this.setState({ phase: 'SAVING', phone, record, error: null, outcome: null });
		try {
			const changed = await this.client.execute(record, phone, action, evidenceReference);
			if (this.active && sequence === this.sequence) {
				this.setState({ phase: 'READY', phone, record: changed, error: null, outcome: changed.outcome });
			}
			return true;
		} catch (error) {
			if (this.active && sequence === this.sequence) {
				// A rejected/uncertain write must never silently retry with a new revision.
				this.setState({ phase: 'ERROR', phone: null, record: null, error: error.message, outcome: null });
			}
			return false;
		} finally { if (sequence === this.sequence) this.busy = false; }
	}
}
