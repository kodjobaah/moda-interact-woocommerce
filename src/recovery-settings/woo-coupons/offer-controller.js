import {
	createMerchantOffersClient,
	validateOfferUpdate,
} from './offer-client';

const MODES = ['NONE', 'FIXED', 'AI_BEST_APPLICABLE'];
const empty = () => ({
	status: 'LOADING',
	catalogueStatus: 'IDLE',
	offers: null,
	page: null,
	mode: 'NONE',
	selectedIds: [],
	history: [],
	search: '',
	error: null,
	catalogueError: null,
	saving: false,
});

/** Offer preferences remain readable and writable without a current coupon catalogue. */
export class MerchantOffersController {
	constructor(client = createMerchantOffersClient()) {
		this.client = client;
		this.state = empty();
		this.listeners = new Set();
		this.epoch = 0;
		this.catalogueEpoch = 0;
		this.disposed = false;
		this.pendingSave = null;
	}

	subscribe(listener) {
		if (this.disposed) return () => {};
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
		if (this.state.saving) return;
		const epoch = ++this.epoch;
		++this.catalogueEpoch;
		this.publish(empty());
		try {
			const offers = await this.client.readOffers();
			if (this.disposed || epoch !== this.epoch) return;
			this.publish({
				status: 'READY',
				offers,
				mode: offers.merchant.recoveryOfferMode,
				selectedIds: [...offers.merchant.selectedDiscountIds],
			});
			if (offers.merchant.recoveryOfferMode === 'FIXED') {
				void this.fetchPage('', []);
			}
		} catch (error) {
			if (!this.disposed && epoch === this.epoch) {
				this.publish({ status: 'ERROR', error: error.message });
			}
		}
	}

	setMode(mode) {
		if (this.state.status !== 'READY' || this.state.saving || !MODES.includes(mode)) return;
		this.publish({ mode, error: null });
		if (mode === 'FIXED' && this.state.catalogueStatus === 'IDLE') {
			void this.fetchPage('', []);
		}
	}

	toggle(id) {
		if (this.state.status !== 'READY' || this.state.mode !== 'FIXED' ||
			this.state.catalogueStatus !== 'READY' || this.state.saving ||
			!this.state.page?.items.some((item) => item.id === id)) return;
		const selected = new Set(this.state.selectedIds);
		if (selected.has(id)) selected.delete(id);
		else if (selected.size < 50) selected.add(id);
		else {
			this.publish({ error: 'SELECTION_LIMIT_EXCEEDED' });
			return;
		}
		this.publish({ selectedIds: [...selected].sort(), error: null });
	}

	async search(term) {
		if (this.state.mode !== 'FIXED' || this.state.catalogueStatus !== 'READY' ||
			this.state.saving) return;
		await this.fetchPage(term.trim(), []);
	}

	async next() {
		if (this.state.mode !== 'FIXED' || this.state.catalogueStatus !== 'READY' ||
			!this.state.page?.nextCursor || this.state.saving) return;
		await this.fetchPage(this.state.search, [
			...this.state.history,
			this.state.page.nextCursor,
		]);
	}

	async previous() {
		if (this.state.mode !== 'FIXED' || this.state.catalogueStatus !== 'READY' ||
			!this.state.history.length || this.state.saving) return;
		await this.fetchPage(this.state.search, this.state.history.slice(0, -1));
	}

	async retryCoupons() {
		if (this.state.status !== 'READY' || this.state.mode !== 'FIXED' ||
			this.state.saving || this.state.catalogueStatus === 'LOADING') return;
		await this.fetchPage(this.state.search, []);
	}

	async fetchPage(search, history) {
		if (this.state.status !== 'READY' || this.state.saving ||
			this.state.catalogueStatus === 'LOADING') return;
		const epoch = ++this.catalogueEpoch;
		this.publish({ catalogueStatus: 'LOADING', catalogueError: null });
		try {
			const page = await this.client.readCatalogue({
				cursor: history.at(-1) ?? null,
				search,
			});
			if (this.disposed || epoch !== this.catalogueEpoch) return;
			this.publish({ catalogueStatus: 'READY', page, search, history, catalogueError: null });
		} catch (error) {
			if (this.disposed || epoch !== this.catalogueEpoch) return;
			this.publish({
				catalogueStatus: error.message === 'CATALOGUE_NOT_CURRENT' ? 'NOT_READY' : 'ERROR',
				page: null,
				catalogueError: error.message,
			});
		}
	}

	cancel() {
		if (!this.state.offers || this.state.saving || this.state.status !== 'READY') return;
		const mode = this.state.offers.merchant.recoveryOfferMode;
		this.publish({
			mode,
			selectedIds: [...this.state.offers.merchant.selectedDiscountIds],
			error: null,
		});
		if (mode === 'FIXED' && this.state.catalogueStatus === 'IDLE') {
			void this.fetchPage('', []);
		}
	}

	isDirty() {
		const { offers, mode, selectedIds } = this.state;
		return !!offers && (
			offers.merchant.recoveryOfferMode !== mode ||
			JSON.stringify([...offers.merchant.selectedDiscountIds].sort()) !==
			JSON.stringify([...selectedIds].sort())
		);
	}

	save() {
		if (this.pendingSave) return this.pendingSave;
		if (this.state.status !== 'READY' || this.state.saving || !this.isDirty() ||
			(this.state.mode === 'FIXED' && this.state.catalogueStatus !== 'READY')) {
			return Promise.resolve();
		}
		let update;
		try {
			update = validateOfferUpdate({
				recoveryOfferMode: this.state.mode,
				selectedDiscountIds: this.state.selectedIds,
			});
		} catch {
			this.publish({ error: 'INVALID_SELECTION' });
			return Promise.resolve();
		}
		const epoch = ++this.epoch;
		this.publish({ saving: true, error: null });
		const task = Promise.resolve()
			.then(() => this.client.saveOffers(update))
			.then((offers) => {
				if (!this.disposed && epoch === this.epoch) {
					this.publish({
						offers,
						mode: offers.merchant.recoveryOfferMode,
						selectedIds: [...offers.merchant.selectedDiscountIds],
						saving: false,
						error: 'SAVED',
					});
				}
			})
			.catch((error) => {
				if (!this.disposed && epoch === this.epoch) {
					this.publish({ saving: false, error: error.message });
				}
			})
			.finally(() => {
				if (this.pendingSave === task) this.pendingSave = null;
			});
		this.pendingSave = task;
		return task;
	}

	dispose() {
		this.disposed = true;
		++this.epoch;
		++this.catalogueEpoch;
		this.listeners.clear();
	}
}
