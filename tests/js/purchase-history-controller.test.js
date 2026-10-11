import { describe, expect, it, vi } from 'vitest';
import { PurchaseHistoryController } from '../../src/billing/purchase-history-controller';

function deferred() {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
function page(filter = 'ACTIVE', pageNo = 1, pageSize = 5) {
	return { filter, page: pageNo, pageSize, totalPages: 3, purchases: [] };
}

describe('PurchaseHistoryController', () => {
	it('loads only while mounted in the connected Billing history view', async () => {
		const client = { getHistory: vi.fn().mockResolvedValue(page()) };
		const controller = new PurchaseHistoryController(client);
		await controller.refresh();
		expect(client.getHistory).not.toHaveBeenCalled();
		controller.setActive(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(client.getHistory).toHaveBeenCalledTimes(1);
		expect(controller.state.data).toEqual(page());
		controller.setActive(false);
		expect(controller.state).toMatchObject({ status: 'IDLE', data: null });
		controller.dispose();
	});

	it('ignores late responses after disconnect and aborts old filter and page requests', async () => {
		const first = deferred();
		const second = deferred();
		const client = {
			getHistory: vi
				.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
		};
		const controller = new PurchaseHistoryController(client);
		controller.setActive(true);
		const firstSignal = client.getHistory.mock.calls[0][3];
		controller.changeFilter('REFUNDED');
		expect(firstSignal.aborted).toBe(true);
		first.resolve(page());
		await first.promise;
		await Promise.resolve();
		expect(controller.state.filter).toBe('REFUNDED');
		controller.setActive(false);
		second.resolve(page('REFUNDED'));
		await second.promise;
		await Promise.resolve();
		expect(controller.state).toMatchObject({ status: 'IDLE', data: null });
		controller.dispose();
	});

	it('resets pagination when changing filters or page size and rejects invalid values', async () => {
		const client = {
			getHistory: vi.fn((filter, pageNo, size) =>
				Promise.resolve(page(filter, pageNo, size))
			),
		};
		const controller = new PurchaseHistoryController(client);
		controller.setActive(true);
		await Promise.resolve();
		controller.changePage(2);
		await Promise.resolve();
		controller.changeFilter('REFUNDED');
		await Promise.resolve();
		expect(controller.state.page).toBe(1);
		controller.changePageSize(20);
		await Promise.resolve();
		expect(controller.state.pageSize).toBe(20);
		controller.changePageSize(13);
		expect(controller.state.pageSize).toBe(20);
		controller.dispose();
	});
});
