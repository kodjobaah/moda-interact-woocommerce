import { createStoreCategoryClient } from './store-category-client';
import { verifyStoreCategorySave } from './store-category-save-reconciliation';

/** Separate state machine: reading is harmless; saving is explicit and generation-checked. */
export class StoreCategoryController {
	constructor(
		client = createStoreCategoryClient(),
		onSaved = () => {},
		onConnectionAttention = () => {}
	) {
		this.client = client;
		this.onSaved = onSaved;
		this.onConnectionAttention = onConnectionAttention;
		this.connectionStatus = 'LOADING';
		this.disposed = false;
		this.revision = 0;
		this.readPromise = null;
		this.savePromise = null;
		this.listeners = new Set();
		this.state = {
			status: 'IDLE',
			data: null,
			categoryId: '',
			mappingIds: [],
		};
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
		for (const listener of this.listeners) {
			listener(state);
		}
	}

	setConnectionStatus(status) {
		if (this.disposed || this.connectionStatus === status) {
			return;
		}
		this.connectionStatus = status;
		if (status !== 'CONNECTED') {
			this.revision++;
			this.publish({
				status: 'IDLE',
				data: null,
				categoryId: '',
				mappingIds: [],
			});
		}
	}

	isCurrent(revision) {
		return (
			!this.disposed &&
			this.connectionStatus === 'CONNECTED' &&
			this.revision === revision
		);
	}

	async refresh() {
		if (
			this.disposed ||
			this.connectionStatus !== 'CONNECTED' ||
			this.savePromise
		) {
			return this.state;
		}
		if (this.readPromise) {
			return this.readPromise;
		}
		const revision = ++this.revision;
		this.publish({ ...this.state, status: 'LOADING' });
		const promise = this.client
			.read()
			.then((data) => {
				if (this.isCurrent(revision)) {
					this.publish(this.fromRead(data, 'READY'));
				}
				return this.state;
			})
			.catch((error) => {
				if (this.isCurrent(revision)) {
					this.failure(error);
				}
				return this.state;
			})
			.finally(() => {
				if (this.readPromise === promise) {
					this.readPromise = null;
				}
			});
		this.readPromise = promise;
		return promise;
	}

	fromRead(data, status) {
		const profile = data.storeProfile;
		const selected = profile.pendingCategory ?? profile.activeCategory;
		const id = selected?.id ?? '';
		const choice = data.categories.find((category) => category.id === id);
		const ids = profile.pendingCategory
			? profile.pendingMappingIds
			: profile.activeMappingIds;
		return {
			status,
			data,
			categoryId: choice ? id : '',
			mappingIds: choice
				? ids.filter((map) =>
						choice.mappings.some((item) => item.id === map)
					)
				: [],
		};
	}

	chooseCategory(categoryId) {
		if (
			!this.canEdit() ||
			!this.state.data?.categories.some((item) => item.id === categoryId)
		) {
			return;
		}
		const { storeProfile } = this.state.data;
		let ids = [];
		if (storeProfile.pendingCategory?.id === categoryId) {
			ids = storeProfile.pendingMappingIds;
		} else if (storeProfile.activeCategory?.id === categoryId) {
			ids = storeProfile.activeMappingIds;
		}
		const choice = this.state.data.categories.find(
			(item) => item.id === categoryId
		);
		this.publish({
			...this.state,
			status: 'READY',
			categoryId,
			mappingIds: ids.filter((id) =>
				choice.mappings.some((map) => map.id === id)
			),
		});
	}

	toggleMapping(id) {
		if (!this.canEdit()) {
			return;
		}
		const category = this.state.data?.categories.find(
			(item) => item.id === this.state.categoryId
		);
		if (!category?.mappings.some((mapping) => mapping.id === id)) {
			return;
		}
		const ids = new Set(this.state.mappingIds);
		if (ids.has(id)) {
			ids.delete(id);
		} else {
			ids.add(id);
		}
		this.publish({ ...this.state, status: 'READY', mappingIds: [...ids] });
	}

	canEdit() {
		return (
			!this.disposed &&
			this.connectionStatus === 'CONNECTED' &&
			['READY', 'SAVED', 'SAVE_FAILED', 'CATEGORY_UNAVAILABLE'].includes(
				this.state.status
			)
		);
	}

	async save() {
		if (
			!this.canEdit() ||
			!this.state.categoryId ||
			this.savePromise ||
			this.readPromise
		) {
			return this.state;
		}
		const revision = ++this.revision;
		const { categoryId, mappingIds, data } = this.state;
		const generation = data.storeProfile.pendingSelectionGeneration;
		this.publish({ ...this.state, status: 'SAVING' });
		const promise = this.client
			.save(categoryId, mappingIds, generation)
			.then(async () => {
				if (!this.isCurrent(revision)) {
					return this.state;
				}
				try {
					await this.onSaved();
				} catch {
					/* Overview refresh has independent error feedback. */
				}
				try {
					const latest = await this.client.read();
					if (this.isCurrent(revision)) {
						this.publish(this.fromRead(latest, 'SAVED'));
					}
				} catch {
					if (this.isCurrent(revision)) {
						this.publish({
							...this.state,
							status: 'SAVED_NEEDS_REFRESH',
						});
					}
				}
				return this.state;
			})
			.catch(async (error) => {
				if (!this.isCurrent(revision)) {
					return this.state;
				}
				if (
					[
						'RECONNECT_REQUIRED',
						'SITE_URL_CHANGED',
						'LOCAL_STATE_INVALID',
						'STORE_CATEGORY_CONFLICT',
						'CATEGORY_UNAVAILABLE',
					].includes(error?.message)
				) {
					this.failure(error);
					return this.state;
				}
				await verifyStoreCategorySave(this, revision, data, {
					categoryId,
					mappingIds,
				});
				return this.state;
			})
			.finally(() => {
				if (this.savePromise === promise) {
					this.savePromise = null;
				}
			});
		this.savePromise = promise;
		return promise;
	}

	failure(error) {
		const code = error?.message;
		if (
			[
				'RECONNECT_REQUIRED',
				'SITE_URL_CHANGED',
				'LOCAL_STATE_INVALID',
			].includes(code)
		) {
			this.publish({ ...this.state, status: 'RECONNECT_REQUIRED' });
			this.onConnectionAttention();
		} else if (code === 'STORE_CATEGORY_CONFLICT') {
			this.publish({ ...this.state, status: 'CONFLICT' });
		} else if (code === 'CATEGORY_UNAVAILABLE') {
			this.publish({ ...this.state, status: 'CATEGORY_UNAVAILABLE' });
		} else {
			this.publish({ ...this.state, status: 'ERROR' });
		}
	}

	dispose() {
		this.disposed = true;
		this.revision++;
		this.listeners.clear();
	}
}
