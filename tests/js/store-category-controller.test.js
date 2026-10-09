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

	it('checks the server after a timed-out POST and recognizes an eventual successful publication', async () => {
		const initial = categoriesFixture();
		const published = categoriesFixture();
		published.storeProfile.activeCategory = {
			id: 'fashion',
			slug: 'fashion',
			localizedDisplayName: 'Fashion',
			localizedDescription: 'Clothing',
		};
		published.storeProfile.activeMappingIds = ['clothing'];
		published.storeProfile.pendingSelectionGeneration = 1;
		const client = {
			read: vi
				.fn()
				.mockResolvedValueOnce(initial)
				.mockResolvedValueOnce(published),
			save: vi.fn().mockRejectedValue(new Error('REMOTE_UNAVAILABLE')),
		};
		const refreshOverview = vi.fn();
		const controller = new StoreCategoryController(client, refreshOverview);
		controller.setConnectionStatus('CONNECTED');
		await controller.refresh();
		controller.chooseCategory('fashion');
		controller.toggleMapping('clothing');
		await controller.save();
		expect(client.save).toHaveBeenCalledTimes(1);
		expect(client.read).toHaveBeenCalledTimes(2);
		expect(controller.state.status).toBe('SAVED');
		expect(refreshOverview).toHaveBeenCalledTimes(1);
	});

	it('retains the attempted selection and permits retry only after an unchanged server readback', async () => {
		const initial = categoriesFixture();
		const published = categoriesFixture();
		published.storeProfile.activeCategory = {
			id: 'fashion',
			slug: 'fashion',
			localizedDisplayName: 'Fashion',
			localizedDescription: 'Clothing',
		};
		published.storeProfile.pendingSelectionGeneration = 1;
		const client = {
			read: vi
				.fn()
				.mockResolvedValueOnce(initial)
				.mockResolvedValueOnce(initial)
				.mockResolvedValueOnce(published),
			save: vi
				.fn()
				.mockRejectedValueOnce(new Error('REMOTE_UNAVAILABLE'))
				.mockResolvedValueOnce(selectedFixture()),
		};
		const controller = new StoreCategoryController(client);
		controller.setConnectionStatus('CONNECTED');
		await controller.refresh();
		controller.chooseCategory('fashion');
		await controller.save();
		expect(controller.state.status).toBe('SAVE_FAILED');
		expect(controller.state.categoryId).toBe('fashion');
		expect(controller.canEdit()).toBe(true);
		expect(client.save).toHaveBeenCalledTimes(1);
		await controller.save();
		expect(client.save).toHaveBeenCalledTimes(2);
		expect(controller.state.status).toBe('SAVED');
	});

	it('blocks a second Save when the first result cannot be verified', async () => {
		const client = {
			read: vi
				.fn()
				.mockResolvedValueOnce(categoriesFixture())
				.mockRejectedValueOnce(new Error('REMOTE_UNAVAILABLE'))
				.mockResolvedValueOnce(categoriesFixture()),
			save: vi.fn().mockRejectedValue(new Error('REMOTE_UNAVAILABLE')),
		};
		const controller = new StoreCategoryController(client);
		controller.setConnectionStatus('CONNECTED');
		await controller.refresh();
		controller.chooseCategory('fashion');
		await controller.save();
		expect(controller.state.status).toBe('VERIFY_REQUIRED');
		expect(controller.canEdit()).toBe(false);
		await controller.save();
		expect(client.save).toHaveBeenCalledTimes(1);
		await controller.refresh();
		expect(client.read).toHaveBeenCalledTimes(3);
		expect(controller.state.status).toBe('READY');
	});

	it('preserves generation-CAS after a failed Save when another administrator published', async () => {
		const later = categoriesFixture();
		later.storeProfile.activeCategory = {
			id: 'electronics',
			slug: 'electronics',
			localizedDisplayName: 'Electronics',
			localizedDescription: 'Devices',
		};
		later.storeProfile.pendingSelectionGeneration = 1;
		const client = {
			read: vi
				.fn()
				.mockResolvedValueOnce(categoriesFixture())
				.mockResolvedValueOnce(later),
			save: vi.fn().mockRejectedValue(new Error('REMOTE_UNAVAILABLE')),
		};
		const controller = new StoreCategoryController(client);
		controller.setConnectionStatus('CONNECTED');
		await controller.refresh();
		controller.chooseCategory('fashion');
		await controller.save();
		expect(controller.state.status).toBe('CONFLICT');
		expect(controller.canEdit()).toBe(false);
		expect(client.save).toHaveBeenCalledTimes(1);
	});
});
