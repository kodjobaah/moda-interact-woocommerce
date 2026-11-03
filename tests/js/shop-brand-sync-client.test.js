import { describe, expect, it, vi } from 'vitest';
import { createShopBrandSyncClient, parseShopBrandStatus, SHOP_BRAND_SYNC_PATH } from '../../src/shop-brand-sync-client';

const status = { status: 'ACCEPTED', lastRequestedAt: '2026-10-27T09:00:00Z', lastAcceptedAt: '2026-10-27T09:01:00Z' };

describe('shop brand sync client', () => {
	it('uses the same-origin REST routes and validates the exact status projection', async () => {
		const request = vi.fn().mockResolvedValue(status);
		const client = createShopBrandSyncClient(request);
		expect(await client.read()).toEqual(status);
		expect(request).toHaveBeenCalledWith({ path: SHOP_BRAND_SYNC_PATH, method: 'GET', signal: undefined });
		expect(() => parseShopBrandStatus({ ...status, shopId: 'foreign' })).toThrow('SHOP_BRAND_STATUS_INVALID');
		expect(() => parseShopBrandStatus({ ...status, lastAcceptedAt: 'yesterday' })).toThrow('SHOP_BRAND_STATUS_INVALID');
	});

	it('accepts only queued command acknowledgements and maps safe REST errors', async () => {
		const request = vi.fn().mockResolvedValue({ status: 'QUEUED' });
		const client = createShopBrandSyncClient(request);
		expect(await client.requestSync()).toEqual({ status: 'QUEUED' });
		expect(request).toHaveBeenCalledWith({ path: SHOP_BRAND_SYNC_PATH, method: 'POST', signal: undefined });
		request.mockResolvedValueOnce({ status: 'ACCEPTED' });
		await expect(client.requestSync()).rejects.toMatchObject({ code: 'SHOP_BRAND_COMMAND_INVALID' });
		request.mockRejectedValueOnce({ data: { status: 'RECONNECT_REQUIRED' } });
		await expect(client.read()).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
	});
});
