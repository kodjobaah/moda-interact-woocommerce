import { createUsageHistoryClient } from './usage-history-client';

export const USAGE_PAGE_SIZES = [10, 25, 50, 100];
export const USAGE_KINDS = ['ALL', 'RECOVERY_CONVERSATION'];
const PERIOD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;

const initial = () => ({
	status: 'IDLE',
	view: 'current',
	periodId: '',
	kind: 'ALL',
	page: 1,
	pageSize: 10,
	periodCursor: '',
	data: null,
	error: null,
});

/** Owns one connected usage-history query and discards stale identity/selection results. */
export class UsageHistoryController {
	constructor(client = createUsageHistoryClient()) {
		this.client = client;
		this.state = initial();
		this.active = false;
		this.disposed = false;
		this.revision = 0;
		this.abortController = null;
		this.listeners = new Set();
	}

	subscribe(listener) {
		if (this.disposed) {
			return () => {};
		}
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	publish(next) {
		if (this.disposed) {
			return;
		}
		this.state = next;
		for (const listener of this.listeners) {
			listener(next);
		}
	}

	invalidate() {
		this.revision += 1;
		this.abortController?.abort();
		this.abortController = null;
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

	change(patch) {
		if (!this.active || this.disposed) {
			return;
		}
		const next = { ...this.state, ...patch };
		if (Object.keys(patch).every((key) => next[key] === this.state[key])) {
			return;
		}
		this.invalidate();
		this.publish({ ...next, status: 'IDLE', error: null });
		this.refresh();
	}

	setView(view) {
		if (!['current', 'past'].includes(view) || view === this.state.view) {
			return;
		}
		this.change({
			view,
			periodId: '',
			periodCursor: '',
			page: 1,
			data: null,
		});
	}

	setPeriod(periodId) {
		// Current usage is determined by the authenticated subscription, not a selector.
		if (this.state.view !== 'past') {
			return;
		}
		if (periodId !== '' && !PERIOD_ID.test(periodId)) {
			return;
		}
		if (
			periodId &&
			!this.state.data?.periodPage?.items?.some(
				(item) => item.id === periodId
			)
		) {
			return;
		}
		this.change({ periodId, page: 1 });
	}

	setKind(kind) {
		if (USAGE_KINDS.includes(kind)) {
			this.change({ kind, page: 1 });
		}
	}

	setPageSize(size) {
		if (USAGE_PAGE_SIZES.includes(size)) {
			this.change({ pageSize: size, page: 1 });
		}
	}

	setPage(page) {
		const total = this.state.data?.usagePagination?.total;
		if (
			!Number.isSafeInteger(page) ||
			page < 1 ||
			!Number.isSafeInteger(total)
		) {
			return;
		}
		if ((page - 1) * this.state.pageSize >= total && page !== 1) {
			return;
		}
		this.change({ page });
	}

	setPeriodCursor(cursor) {
		if (this.state.view !== 'past') {
			return;
		}
		if (typeof cursor !== 'string' || !CURSOR.test(cursor)) {
			return;
		}
		const page = this.state.data?.periodPage;
		if (![page?.nextCursor, page?.previousCursor].includes(cursor)) {
			return;
		}
		this.change({ periodCursor: cursor, periodId: '', page: 1 });
	}

	async refresh() {
		if (!this.active || this.disposed || this.state.status === 'LOADING') {
			return;
		}
		if (!this.client.available) {
			this.publish({
				...this.state,
				status: 'UNAVAILABLE',
				data: null,
				error: null,
			});
			return;
		}
		this.invalidate();
		const revision = this.revision;
		const controller = new AbortController();
		this.abortController = controller;
		const { view, periodId, kind, page, pageSize, periodCursor } =
			this.state;
		this.publish({
			...this.state,
			status: 'LOADING',
			data: null,
			error: null,
		});
		try {
			const data = await this.client.getHistory(
				{ view, periodId, kind, page, pageSize, periodCursor },
				controller.signal
			);
			if (this.current(revision)) {
				if (
					!data ||
					!Array.isArray(data.usageEvents) ||
					!Array.isArray(data.periodPage?.items) ||
					!Number.isSafeInteger(data.usagePagination?.total)
				) {
					throw new Error('invalid_response');
				}
				this.publish({
					...this.state,
					status:
						data.state === 'unavailable' ? 'UNAVAILABLE' : 'READY',
					data,
				});
			}
		} catch (error) {
			if (this.current(revision)) {
				const code = error?.code ?? error?.message;
				let status = 'FAILED';
				if (code === 'reconnect_required') {
					status = 'RECONNECT';
				} else if (code === 'invalid_period') {
					status = 'INVALID_PERIOD';
				} else if (code === 'invalid_cursor') {
					status = 'INVALID_CURSOR';
				} else if (code === 'permission_denied') {
					status = 'DENIED';
				} else if (code === 'usage_history_unavailable') {
					status = 'UNAVAILABLE';
				}
				this.publish({
					...this.state,
					status,
					error: code,
					data: null,
				});
			}
		} finally {
			if (this.current(revision)) {
				this.abortController = null;
			}
		}
	}

	current(revision) {
		return this.active && !this.disposed && revision === this.revision;
	}

	clearCursor() {
		this.change({ periodCursor: '', periodId: '', page: 1 });
	}

	dispose() {
		this.invalidate();
		this.active = false;
		this.disposed = true;
		this.listeners.clear();
	}
}
