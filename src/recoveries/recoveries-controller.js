import { createRecoveriesClient } from './api/recoveries-client';

function initialState() {
	return { status: 'IDLE', data: null, error: null };
}

/** Owns applied filters and page cursor; replaces in-flight requests on navigation. */
export class RecoveriesController {
	constructor(client = createRecoveriesClient(), initialQuery = null) {
		this.client = client;
		this.state = initialState();
		this.listeners = new Set();
		this.active = false;
		this.revision = 0;
		this.abortController = null;
		this.query = initialQuery ?? { page: 1, pageSize: 25 }; // Restore list filters after detail navigation.
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
			this.refresh();
		} else {
			this.invalidate();
			this.query = { page: 1, pageSize: 25 };
			this.publish(initialState());
		}
	}

	invalidate() {
		this.revision += 1;
		this.abortController?.abort();
		this.abortController = null;
	}

	applyFilters(filters) {
		if (!this.active) {
			return;
		}
		this.query = {
			from: filters.from,
			to: filters.to,
			q: filters.q.trim(),
			status: filters.status,
			page: 1,
			pageSize: 25,
		};
		return this.refresh();
	}

	clearFilters() {
		if (!this.active) {
			return;
		}
		this.query = { page: 1, pageSize: 25 };
		return this.refresh();
	}

	goToPage(page) {
		const data = this.state.data;
		if (
			!this.active ||
			!data ||
			this.state.status !== 'READY' ||
			!Number.isSafeInteger(page) ||
			page < 1 ||
			page > data.totalPages ||
			page === data.page
		) {
			return;
		}
		this.query = { ...this.query, page };
		return this.refresh();
	}

	async refresh() {
		if (!this.active) {
			return;
		}
		this.invalidate();
		const revision = this.revision;
		const controller = new AbortController();
		this.abortController = controller;
		const query = { ...this.query };
		this.publish({ status: 'LOADING', data: this.state.data, error: null });
		try {
			const data = await this.client.list(query, controller.signal);
			if (this.active && revision === this.revision) {
				// Freeze the server-resolved store-local date window across later pages.
				this.query = {
					from: data.from,
					to: data.to,
					q: data.q,
					status: data.status,
					page: data.page,
					pageSize: data.pageSize,
				};
				this.publish({ status: 'READY', data, error: null });
			}
		} catch {
			if (this.active && revision === this.revision) {
				this.publish({
					status: 'ERROR',
					data: null,
					error: 'remote_unavailable',
				});
			}
		} finally {
			if (revision === this.revision) {
				this.abortController = null;
			}
		}
	}
}
