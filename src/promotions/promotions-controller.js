import { createPromotionsClient } from './promotions-client';
import { validCampaignId, validPromotionPage } from './promotions-contract';

const empty = () => ({
	status: 'IDLE',
	offers: [],
	offersPagination: { page: 1, pageSize: 6, totalEntries: 0, totalPages: 1 },
	selection: null,
	history: { entries: [], page: 1, pageSize: 6, totalEntries: 0, totalPages: 1 },
	revision: null,
	saving: false,
	error: null,
});

const errorStatus = (error) => {
	const code = error?.code ?? error?.message;
	if (code === 'RECONNECT_REQUIRED') return 'RECONNECT_REQUIRED';
	if (code === 'DENIED' || code === 'FORBIDDEN') return 'DENIED';
	if (code === 'PROMOTION_STALE' || code === 'PROMOTION_CONFLICT' || code === 'CONFLICT') return 'CONFLICT';
	if (code === 'REMOTE_UNAVAILABLE' || code === 'API_NOT_CONFIGURED') return 'UNAVAILABLE';
	return 'ERROR';
};

/** One connected installation's authoritative read and compare-and-set lifecycle. */
export class PromotionsController {
	constructor(client = createPromotionsClient()) {
		this.client = client;
		this.state = empty();
		this.listeners = new Set();
		this.active = false;
		this.disposed = false;
		this.sequence = 0;
		this.readAbort = null;
		this.writeAbort = null;
		this.selecting = false;
	}

	subscribe(listener) {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	publish(state) {
		if (this.disposed) return;
		this.state = state;
		for (const listener of this.listeners) listener(state);
	}

	invalidate() {
		this.sequence++;
		this.readAbort?.abort();
		this.readAbort = null;
	}

	current(sequence) {
		return this.active && !this.disposed && this.sequence === sequence;
	}

	setActive(active) {
		if (this.disposed || this.active === active) return;
		this.active = active;
		if (!active) {
			this.invalidate();
			this.writeAbort?.abort();
			this.writeAbort = null;
			this.selecting = false;
			this.publish(empty());
		} else {
			void this.refresh();
		}
	}

	async refresh(notice = null) {
		if (!this.active || this.disposed || this.selecting) return false;
		this.invalidate();
		const sequence = this.sequence;
		const abort = new AbortController();
		this.readAbort = abort;
		const offerPage = this.state.offersPagination.page;
		const historyPage = this.state.history.page;
		this.publish({ ...this.state, status: 'LOADING', saving: false, error: null,
			// Do not show cached grants while another tenant/credential is being checked.
			offers: [], selection: null, revision: null,
			history: { ...this.state.history, entries: [] },
		});
		try {
			const data = await this.client.read({ offerPage, historyPage }, abort.signal);
			if (!this.current(sequence)) return false;
			this.publish({ status: 'READY', ...data, saving: false, error: notice });
			return true;
		} catch (error) {
			if (!this.current(sequence)) return false;
			this.publish({ ...empty(), status: errorStatus(error), error: error?.code ?? null });
			return false;
		} finally {
			if (this.current(sequence)) this.readAbort = null;
		}
	}

	goToOffersPage(page) {
		if (!this.canPage(page, this.state.offersPagination)) return false;
		this.publish({ ...this.state,
			offersPagination: { ...this.state.offersPagination, page },
		});
		return this.refresh();
	}

	goToHistoryPage(page) {
		if (!this.canPage(page, this.state.history)) return false;
		this.publish({ ...this.state,
			history: { ...this.state.history, page },
		});
		return this.refresh();
	}

	canPage(page, pagination) {
		return this.active && !this.disposed && !this.selecting &&
			this.state.status === 'READY' && validPromotionPage(page) &&
			page <= pagination.totalPages && page !== pagination.page;
	}

	async select(campaignId) {
		if (!this.active || this.disposed || this.selecting || this.state.saving || this.state.status !== 'READY' ||
			!validCampaignId(campaignId) || !this.state.revision || this.state.selection?.locked ||
			this.state.selection?.campaignId === campaignId) return false;
		const offer = this.state.offers.find((item) => item.id === campaignId);
		if (!offer || !offer.eligible || !offer.selectable || offer.exhausted ||
			offer.previouslyClaimed || offer.currentlySelected) return false;
		// Synchronous latch: a second click cannot reuse the same authoritative revision.
		this.selecting = true;
		this.invalidate();
		const sequence = this.sequence;
		const revision = this.state.revision;
		const abort = new AbortController();
		this.writeAbort = abort;
		this.publish({ ...this.state, saving: true, error: null });
		let notice = null;
		try {
			// PUT confirmation alone never claims a new grant on-screen: GET owns it.
			await this.client.select(campaignId, revision, abort.signal);
		} catch (error) {
			if (!this.current(sequence)) return false;
			const status = errorStatus(error);
			if (status === 'CONFLICT') {
				notice = 'CONFLICT';
			} else if (error?.code === 'PROMOTION_INELIGIBLE') {
				notice = 'PROMOTION_INELIGIBLE';
			} else {
				this.publish({ ...empty(), status, error: error?.code ?? null });
				return false;
			}
		} finally {
			if (this.current(sequence)) {
				this.selecting = false;
				this.writeAbort = null;
			}
		}
		if (!this.current(sequence)) return false;
		// Refresh selection AND history. On uncertainty, disable until a new GET.
		return this.refresh(notice);
	}

	dispose() {
		this.invalidate();
		this.writeAbort?.abort();
		this.writeAbort = null;
		this.selecting = false;
		this.active = false;
		this.disposed = true;
		this.listeners.clear();
	}
}
