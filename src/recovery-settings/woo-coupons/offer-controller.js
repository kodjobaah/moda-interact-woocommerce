import { createMerchantOffersClient, validateOfferUpdate } from './offer-client';

const empty = () => ({ status: 'LOADING', offers: null, page: null,
	mode: 'NONE', selectedIds: [], history: [], search: '', error: null, saving: false });

/** One controller per mounted Recovery Offer section. No automatic writes. */
export class MerchantOffersController {
	constructor(client = createMerchantOffersClient()) {
		this.client = client;
		this.state = empty();
		this.listeners = new Set();
		this.epoch = 0;
		this.disposed = false;
		this.pendingSave = null;
	}

	subscribe(listener) {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}
	publish(patch) {
		if (this.disposed) return;
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener(this.state);
	}
	async refresh() {
		const epoch = ++this.epoch;
		this.publish({ ...empty() });
		try {
			const offers = await this.client.readOffers();
			const page = await this.client.readCatalogue({});
			if (this.disposed || epoch !== this.epoch) return;
			this.publish({ status: 'READY', offers, page,
				mode: offers.merchant.recoveryOfferMode,
				selectedIds: [...offers.merchant.selectedDiscountIds],
				history: [], search: '', error: null });
		} catch (error) {
			if (this.disposed || epoch !== this.epoch) return;
			this.publish({ status: error.message === 'CATALOGUE_NOT_CURRENT' ? 'NOT_READY' : 'ERROR', error: error.message });
		}
	}

	setMode(mode) {
		if (this.state.status !== 'READY' || this.state.saving || !['NONE', 'FIXED', 'AI_BEST_APPLICABLE'].includes(mode)) return;
		this.publish({ mode, error: null });
	}
	toggle(id) {
		if (this.state.status !== 'READY' || this.state.saving || !this.state.page?.items.some((item) => item.id === id)) return;
		const set = new Set(this.state.selectedIds);
		if (set.has(id)) set.delete(id);
		else if (set.size < 50) set.add(id);
		else { this.publish({ error: 'SELECTION_LIMIT_EXCEEDED' }); return; }
		this.publish({ selectedIds: [...set].sort(), error: null });
	}

	async search(term) {
		if (this.state.status !== 'READY' || this.state.saving) return;
		await this.fetchPage(term.trim(), []);
	}
	async next() {
		if (this.state.status !== 'READY' || !this.state.page?.nextCursor || this.state.saving) return;
		await this.fetchPage(this.state.search, [...this.state.history, this.state.page.nextCursor]);
	}
	async previous() {
		if (this.state.status !== 'READY' || !this.state.history.length || this.state.saving) return;
		await this.fetchPage(this.state.search, this.state.history.slice(0, -1));
	}
	async fetchPage(search, history) {
		const epoch = ++this.epoch;
		this.publish({ status: 'PAGING', error: null });
		try {
			const page = await this.client.readCatalogue({ cursor: history.at(-1) ?? null, search });
			if (this.disposed || epoch !== this.epoch) return;
			this.publish({ status: 'READY', page, search, history, error: null });
		} catch (error) {
			if (this.disposed || epoch !== this.epoch) return;
			this.publish({ status: 'READY', error: error.message });
		}
	}

	cancel() {
		if (!this.state.offers || this.state.saving || this.state.status !== 'READY') return;
		this.publish({ mode: this.state.offers.merchant.recoveryOfferMode,
			selectedIds: [...this.state.offers.merchant.selectedDiscountIds], error: null });
	}

	isDirty() {
		const { offers, mode, selectedIds } = this.state;
		return !!offers && (offers.merchant.recoveryOfferMode !== mode ||
			JSON.stringify([...offers.merchant.selectedDiscountIds].sort()) !== JSON.stringify([...selectedIds].sort()));
	}

	save() {
		if (this.pendingSave) return this.pendingSave;
		if (this.state.status !== 'READY' || this.state.saving || !this.isDirty()) return Promise.resolve();
		let update;
		try {
			update = validateOfferUpdate({ recoveryOfferMode: this.state.mode,
				selectedDiscountIds: this.state.selectedIds });
		} catch { this.publish({ error: 'INVALID_SELECTION' }); return Promise.resolve(); }
		const epoch = ++this.epoch;
		this.publish({ saving: true, error: null });
		const task = Promise.resolve().then(() => this.client.saveOffers(update))
			.then((offers) => {
				if (!this.disposed && epoch === this.epoch) {
					this.publish({ offers, mode: offers.merchant.recoveryOfferMode,
						selectedIds: [...offers.merchant.selectedDiscountIds], saving: false, error: 'SAVED' });
				}
			}).catch((error) => {
				if (!this.disposed && epoch === this.epoch) this.publish({ saving: false, error: error.message });
			}).finally(() => { if (this.pendingSave === task) this.pendingSave = null; });
		this.pendingSave = task;
		return task;
	}
	dispose() { this.disposed = true; this.epoch += 1; this.listeners.clear(); }
}
