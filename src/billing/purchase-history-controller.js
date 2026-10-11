import { createPurchaseHistoryClient } from './purchase-history-client';
import {
	HISTORY_FILTERS,
	HISTORY_PAGE_SIZES,
} from './purchase-history-contract';

function initial() {
	return {
		status: 'IDLE',
		filter: 'ACTIVE',
		page: 1,
		pageSize: 5,
		data: null,
		error: null,
	};
}

/** Independent history session: abort and discard requests on switch/disconnect. */
export class PurchaseHistoryController {
	constructor(client = createPurchaseHistoryClient()) {
		this.client = client;
		this.state = initial();
		this.listeners = new Set();
		this.active = false;
		this.disposed = false;
		this.revision = 0;
		this.requestController = null;
	}

	subscribe(listener) {
		if (this.disposed) {
			return () => {};
		}
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	setActive(active) {
		if (this.disposed || this.active === active) {
			return;
		}
		this.active = active;
		if (!active) {
			this.invalidate();
			this.publish(initial());
		} else {
			this.refresh();
		}
	}

	changeFilter(filter) {
		if (!this.active || !HISTORY_FILTERS.includes(filter)) {
			return;
		}
		this.publish({ ...this.state, filter, page: 1 });
		this.refresh();
	}

	changePageSize(pageSize) {
		if (!this.active || !HISTORY_PAGE_SIZES.includes(pageSize)) {
			return;
		}
		this.publish({ ...this.state, pageSize, page: 1 });
		this.refresh();
	}

	changePage(page) {
		if (
			!this.active ||
			!Number.isSafeInteger(page) ||
			page < 1 ||
			page > (this.state.data?.totalPages ?? 1)
		) {
			return;
		}
		this.publish({ ...this.state, page });
		this.refresh();
	}

	async refresh() {
		if (!this.active || this.disposed) {
			return;
		}
		this.invalidate();
		const revision = this.revision;
		const controller = new AbortController();
		this.requestController = controller;
		const { filter, page, pageSize } = this.state;
		this.publish({
			...this.state,
			status: 'LOADING',
			data: null,
			error: null,
		});
		try {
			const data = await this.client.getHistory(
				filter,
				page,
				pageSize,
				controller.signal
			);
			if (this.current(revision)) {
				this.publish({
					...this.state,
					status: 'READY',
					data,
					page: data.page,
				});
			}
		} catch (error) {
			if (this.current(revision)) {
				this.publish({
					...this.state,
					status: 'FAILED',
					error: error?.message ?? 'remote_unavailable',
				});
			}
		} finally {
			if (this.current(revision)) {
				this.requestController = null;
			}
		}
	}

	invalidate() {
		this.revision += 1;
		this.requestController?.abort();
		this.requestController = null;
	}

	current(revision) {
		return !this.disposed && this.active && revision === this.revision;
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

	dispose() {
		this.invalidate();
		this.disposed = true;
		this.listeners.clear();
	}
}
