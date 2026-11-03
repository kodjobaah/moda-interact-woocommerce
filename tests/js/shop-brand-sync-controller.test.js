import { describe, expect, it, vi } from 'vitest';
import { ShopBrandSyncController } from '../../src/shop-brand-sync-controller';

const accepted = { status: 'ACCEPTED', lastRequestedAt: '2026-10-27T09:00:00Z', lastAcceptedAt: '2026-10-27T09:01:00Z' };

describe('shop brand sync controller', () => {
	it('reads only while the connected Recovery Settings session is active and resets on disconnect', async () => {
		const client = { read: vi.fn().mockResolvedValue(accepted), requestSync: vi.fn() };
		const controller = new ShopBrandSyncController(client);
		controller.setConnection({ status: 'CONNECTED', installationId: 'install-1', credentialVersion: 1 });
		controller.setActive(true);
		await vi.waitFor(() => expect(client.read).toHaveBeenCalledOnce());
		expect(controller.state.data).toEqual(accepted);
		controller.setConnection({ status: 'DISCONNECTED' });
		expect(controller.state.data).toBeNull();
		controller.dispose();
	});

	it('does not submit duplicate commands while one is unresolved', async () => {
		const client = {
			read: vi.fn().mockResolvedValue({ ...accepted, status: 'NEVER_SYNCED' }),
			requestSync: vi.fn(() => new Promise((resolve) => { client.resolve = resolve; })),
		};
		const controller = new ShopBrandSyncController(client);
		controller.setConnection({ status: 'CONNECTED', installationId: 'install-1', credentialVersion: 1 });
		controller.setActive(true);
		await vi.waitFor(() => expect(client.read).toHaveBeenCalledOnce());
		const pending = controller.sync();
		await vi.waitFor(() => expect(client.requestSync).toHaveBeenCalledOnce());
		await controller.sync();
		expect(client.requestSync).toHaveBeenCalledOnce();
		client.resolve({ status: 'QUEUED' });
		await vi.waitFor(() => expect(controller.state.commandPending).toBe(false));
		controller.dispose();
		await pending;
	});

	it('queues a Sync branding click made while the initial status read is pending', async () => {
		let resolveRead;
		const client = {
			read: vi.fn(() => new Promise((resolve) => { resolveRead = resolve; })),
			requestSync: vi.fn().mockResolvedValue({ status: 'QUEUED' }),
		};
		const controller = new ShopBrandSyncController(client);
		controller.setConnection({ status: 'CONNECTED', installationId: 'install-1', credentialVersion: 1 });
		controller.setActive(true);
		await vi.waitFor(() => expect(client.read).toHaveBeenCalledOnce());

		const pendingSync = controller.sync();
		expect(client.requestSync).not.toHaveBeenCalled();
		resolveRead({ status: 'NEVER_SYNCED', lastRequestedAt: null, lastAcceptedAt: null });
		await vi.waitFor(() => expect(client.requestSync).toHaveBeenCalledOnce());

		controller.dispose();
		await pendingSync;
		expect(client.requestSync).toHaveBeenCalledOnce();
	});

	it('clears pending command state when disposed while a client ignores abort', async () => {
		let resolveCommand;
		const client = {
			read: vi.fn().mockResolvedValue({ ...accepted, status: 'NEVER_SYNCED', lastRequestedAt: null, lastAcceptedAt: null }),
			requestSync: vi.fn(() => new Promise((resolve) => { resolveCommand = resolve; })),
		};
		const controller = new ShopBrandSyncController(client);
		controller.setConnection({ status: 'CONNECTED', installationId: 'install-1', credentialVersion: 1 });
		controller.setActive(true);
		await vi.waitFor(() => expect(client.read).toHaveBeenCalledOnce());
		const pending = controller.sync();
		await vi.waitFor(() => expect(client.requestSync).toHaveBeenCalledOnce());

		controller.dispose();
		expect(controller.state.commandPending).toBe(false);
		resolveCommand({ status: 'QUEUED' });
		await pending;
		expect(controller.state.commandPending).toBe(false);
	});
});
