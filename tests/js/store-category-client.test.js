import { describe, expect, it, vi } from 'vitest';
import {
	createStoreCategoryClient,
	parseStoreCategories,
	parseCategorySelection,
} from '../../src/store-category-client';
import { categoriesFixture, selectedFixture } from './store-category-fixtures';

describe('Woo category REST facade client', () => {
	it('validates the read contract and never publishes during GET', async () => {
		const request = vi.fn().mockResolvedValue(categoriesFixture());
		const client = createStoreCategoryClient(request);
		expect(
			(await client.read()).storeProfile.pendingSelectionGeneration
		).toBe(0);
		expect(request).toHaveBeenCalledWith({
			path: '/moda-interact/v1/merchant/store-categories',
			method: 'GET',
		});
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('rejects malformed read responses rather than displaying wrong tenant data', () => {
		const payload = categoriesFixture();
		payload.storeProfile.shopId = 'other_shop';
		expect(() => parseStoreCategories(payload)).toThrow(
			'REMOTE_RESPONSE_INVALID'
		);
	});

	it('sends exactly category, mapping identifiers and generation (no credential or shop ID)', async () => {
		const request = vi.fn().mockResolvedValue(selectedFixture());
		const client = createStoreCategoryClient(request);
		await client.save('fashion', ['clothing'], 0);
		expect(request).toHaveBeenCalledWith({
			path: '/moda-interact/v1/merchant/store-category',
			method: 'POST',
			data: {
				schemaVersion: 1,
				categoryId: 'fashion',
				selectedMappingIds: ['clothing'],
				expectedPendingSelectionGeneration: 0,
			},
		});
	});

	it('rejects mismatched or missing mutation confirmations', async () => {
		const incorrect = selectedFixture();
		incorrect.activeCategoryId = 'electronics';
		expect(() => parseCategorySelection(incorrect)).not.toThrow();
		const client = createStoreCategoryClient(
			vi.fn().mockResolvedValue(incorrect)
		);
		await expect(client.save('fashion', [], 0)).rejects.toThrow(
			'REMOTE_RESPONSE_INVALID'
		);
	});

	it('maps WordPress HTTP 409 into a refresh/reselect conflict', async () => {
		const client = createStoreCategoryClient(
			vi.fn().mockRejectedValue({
				data: { status: 'STORE_CATEGORY_CONFLICT' },
			})
		);
		await expect(client.save('fashion', [], 0)).rejects.toThrow(
			'STORE_CATEGORY_CONFLICT'
		);
	});
});
