import { describe, expect, it, vi } from 'vitest';
import { StoreContextSyncController } from '../../src/store-context-sync-controller';

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((ok, fail) => {
		resolve = ok;
		reject = fail;
	});
	return { promise, resolve, reject };
}

describe('store context synchronization controller', () => {
	it('never syncs on page load, disconnected state or repeated ordinary reads', async () => {
		const client = { sync: vi.fn().mockResolvedValue() };
		const controller = new StoreContextSyncController(client);
		await controller.sync();
		controller.setConnectionStatus('CONNECTED');
		expect(client.sync).not.toHaveBeenCalled();
		await controller.sync();
		expect(client.sync).toHaveBeenCalledTimes(1);
	});

	it('serializes in-flight attempts and refreshes the bootstrap after successful write', async () => {
		const result = deferred();
		const client = { sync: vi.fn(() => result.promise) };
		const refresh = vi.fn().mockResolvedValue();
		const controller = new StoreContextSyncController(client, refresh);
		controller.setConnectionStatus('CONNECTED');
		const first = controller.sync();
		const second = controller.sync();
		expect(first).toBe(second);
		expect(client.sync).toHaveBeenCalledTimes(1);
		expect(controller.state.status).toBe('SYNCING');
		result.resolve();
		await first;
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(controller.state.status).toBe('SYNCED');
	});

	it('failed updates remain retryable without invoking refresh or reconnect', async () => {
		const client = {
			sync: vi
				.fn()
				.mockRejectedValueOnce(new Error('private'))
				.mockResolvedValue(),
		};
		const refresh = vi.fn().mockResolvedValue();
		const controller = new StoreContextSyncController(client, refresh);
		controller.setConnectionStatus('CONNECTED');
		await controller.sync();
		expect(controller.state).toEqual({ status: 'ERROR' });
		expect(refresh).not.toHaveBeenCalled();
		await controller.sync();
		expect(controller.state).toEqual({ status: 'SYNCED' });
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(controller.state)).not.toContain('private');
	});

	it('ignores a stale completion after disconnection or disposal', async () => {
		const result = deferred();
		const refresh = vi.fn();
		const controller = new StoreContextSyncController(
			{ sync: () => result.promise },
			refresh
		);
		controller.setConnectionStatus('CONNECTED');
		const pending = controller.sync();
		controller.setConnectionStatus('RECONNECT_REQUIRED');
		result.resolve();
		await pending;
		expect(controller.state).toEqual({ status: 'IDLE' });
		expect(refresh).not.toHaveBeenCalled();
		controller.dispose();
	});
});
