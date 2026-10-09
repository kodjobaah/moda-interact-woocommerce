import { describe, expect, it, vi } from 'vitest';
import { StoreCategoryController } from '../../src/store-category-controller';
import { categoriesFixture, selectedFixture } from './store-category-fixtures';

function deferred() {
	let resolve;
	const promise = new Promise((callback) => {
		resolve = callback;
	});
	return { promise, resolve };
}

describe('modular Woo category state controller', () => {
	it('does not load/publish/select on page load or connection establishment', () => {
		const client = { read: vi.fn(), save: vi.fn() };
		const controller = new StoreCategoryController(client);
		controller.setConnectionStatus('CONNECTED');
		expect(client.read).not.toHaveBeenCalled();
		expect(client.save).not.toHaveBeenCalled();
	});

	it('explicit Save activates category and refreshes both category and existing Overview', async () => {
		const start = categoriesFixture();
		const updated = categoriesFixture();
		updated.storeProfile.activeCategory = {
			id: 'fashion',
			slug: 'fashion',
			localizedDisplayName: 'Fashion',
			localizedDescription: 'Clothing',
		};
		updated.storeProfile.activeMappingIds = ['clothing'];
		updated.storeProfile.pendingSelectionGeneration = 1;
		const client = {
			read: vi
				.fn()
				.mockResolvedValueOnce(start)
				.mockResolvedValueOnce(updated),
			save: vi.fn().mockResolvedValue(selectedFixture()),
		};
		const refreshOverview = vi.fn();
		const controller = new StoreCategoryController(client, refreshOverview);
		controller.setConnectionStatus('CONNECTED');
		await controller.refresh();
		controller.chooseCategory('fashion');
		controller.toggleMapping('clothing');
		expect(controller.state.categoryId).toBe('fashion');
		await controller.save();
		expect(client.save).toHaveBeenCalledWith('fashion', ['clothing'], 0);
		expect(controller.state.status).toBe('SAVED');
		expect(controller.state.data.storeProfile.activeCategory.id).toBe(
			'fashion'
		);
		expect(refreshOverview).toHaveBeenCalledTimes(1);
	});

	it('does not auto-overwrite a second administrator on 409 conflict', async () => {
		const client = {
			read: vi.fn().mockResolvedValue(categoriesFixture()),
			save: vi
				.fn()
				.mockRejectedValue(new Error('STORE_CATEGORY_CONFLICT')),
		};
		const controller = new StoreCategoryController(client);
		controller.setConnectionStatus('CONNECTED');
		await controller.refresh();
		controller.chooseCategory('fashion');
		await controller.save();
		expect(controller.state.status).toBe('CONFLICT');
		expect(client.save).toHaveBeenCalledTimes(1);
		await controller.save();
		expect(client.save).toHaveBeenCalledTimes(1);
		await controller.refresh();
		expect(controller.state.status).toBe('READY');
	});

	it('blocks unsupported mapping identifiers and disables stale completions', async () => {
		const delayed = deferred();
		const client = { read: vi.fn(() => delayed.promise), save: vi.fn() };
		const controller = new StoreCategoryController(client);
		controller.setConnectionStatus('CONNECTED');
		const pending = controller.refresh();
		controller.setConnectionStatus('DISCONNECTED');
		delayed.resolve(categoriesFixture());
		await pending;
		expect(controller.state.status).toBe('IDLE');
		controller.setConnectionStatus('CONNECTED');
		await controller.refresh();
		controller.chooseCategory('fashion');
		controller.toggleMapping('foreign_mapping');
		expect(controller.state.mappingIds).toEqual([]);
	});
});
