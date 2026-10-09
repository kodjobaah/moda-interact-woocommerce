import { describe, expect, it, vi } from 'vitest';
import {
	createStoreContextSyncClient,
	STORE_CONTEXT_SYNC_PATH,
} from '../../src/store-context-sync-client';

describe('store context sync client', () => {
	it('sends a server-derived, bodyless WordPress REST command', async () => {
		const request = vi.fn().mockResolvedValue({ status: 'SYNCED' });
		await createStoreContextSyncClient(request).sync();
		expect(request).toHaveBeenCalledWith({
			path: STORE_CONTEXT_SYNC_PATH,
			method: 'POST',
		});
		expect(request).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(request.mock.calls)).not.toMatch(
			/credential|shopId|countryCode/
		);
	});

	it.each([
		undefined,
		null,
		{ status: 'CONNECTED' },
		{ status: 'SYNCED', token: 'secret' },
	])(
		'rejects malformed success instead of pretending settings were saved',
		async (response) => {
			await expect(
				createStoreContextSyncClient(
					vi.fn().mockResolvedValue(response)
				).sync()
			).rejects.toThrow('STORE_CONTEXT_SYNC_FAILED');
		}
	);
});
