import { describe, expect, it, vi } from 'vitest';
import { RecoveriesController } from '../../src/recoveries/recoveries-controller';

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function result(query, page = 1, totalPages = 3) {
	return {
		page,
		pageSize: query.pageSize,
		totalPages,
		hasNext: page < totalPages,
		hasPrevious: page > 1,
		timeZone: 'Europe/London',
		from: query.from ?? '2026-09-12',
		to: query.to ?? '2026-10-11',
		q: query.q ?? '',
		status: query.status ?? 'all',
		items: [],
	};
}

describe('Recoveries paging/filter controller', () => {
	it('loads store-local defaults and pages without client-side slicing', async () => {
		const client = {
			list: vi.fn(async (query) => result(query, query.page)),
		};
		const controller = new RecoveriesController(client);
		controller.setActive(true);
		await Promise.resolve();
		expect(client.list.mock.calls[0][0]).toEqual({ page: 1, pageSize: 25 });
		await controller.goToPage(2);
		expect(client.list.mock.calls[1][0]).toEqual({
			from: '2026-09-12',
			to: '2026-10-11',
			q: '',
			status: 'all',
			page: 2,
			pageSize: 25,
		});
		await controller.refresh();
		expect(client.list.mock.calls[2][0]).toEqual(
			client.list.mock.calls[1][0]
		);
		await controller.applyFilters({
			from: '2026-10-01',
			to: '2026-10-11',
			q: '  Ada ',
			status: 'COMPLETED',
		});
		expect(client.list.mock.calls[3][0]).toEqual({
			from: '2026-10-01',
			to: '2026-10-11',
			q: 'Ada',
			status: 'COMPLETED',
			page: 1,
			pageSize: 25,
		});
		await controller.goToPage(2);
		expect(client.list.mock.calls[4][0]).toMatchObject({
			page: 2,
			q: 'Ada',
		});
		await controller.clearFilters();
		expect(client.list.mock.calls[5][0]).toEqual({ page: 1, pageSize: 25 });
		controller.setActive(false);
	});

	it('aborts superseded requests and discards stale responses on disconnect', async () => {
		const first = deferred();
		const second = deferred();
		const client = {
			list: vi
				.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
		};
		const controller = new RecoveriesController(client);
		controller.setActive(true);
		const signal = client.list.mock.calls[0][1];
		const next = controller.applyFilters({
			from: '2026-10-01',
			to: '2026-10-11',
			q: 'Ada',
			status: 'all',
		});
		expect(signal.aborted).toBe(true);
		first.resolve(result({ pageSize: 25 }));
		await first.promise;
		await Promise.resolve();
		expect(controller.state.status).toBe('LOADING');
		controller.setActive(false);
		second.resolve(result({ pageSize: 25 }));
		await next;
		expect(controller.state).toMatchObject({ status: 'IDLE', data: null });
		controller.setActive(true);
		controller.setActive(false);
	});

	it('clamped pages follow the server cursor and cannot navigate outside the total', async () => {
		const client = {
			list: vi.fn(async (query) =>
				result(query, Math.min(query.page, 2), 2)
			),
		};
		const controller = new RecoveriesController(client);
		controller.setActive(true);
		await Promise.resolve();
		await controller.goToPage(2);
		expect(controller.state.data.page).toBe(2);
		controller.goToPage(3);
		expect(client.list).toHaveBeenCalledTimes(2);
		controller.setActive(false);
	});
});
