import { describe, expect, it, vi } from 'vitest';
import { ConnectionController } from '../../src/connection-controller';

const connected = {
	status: 'CONNECTED',
	installationId: 'install_safe',
	shopId: 'shop_safe',
	canonicalSiteUrl: 'https://merchant.example',
	credentialVersion: 1,
};

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe('connection controller', () => {
	it('loads an explicit local failure state on transport errors', async () => {
		const client = {
			getStatus: vi.fn().mockRejectedValue(new Error('private detail')),
		};
		const controller = new ConnectionController(client);
		await controller.refresh();
		expect(controller.state.connection).toEqual({ status: 'LOAD_FAILED' });
		expect(JSON.stringify(controller.state)).not.toContain(
			'private detail'
		);
	});

	it('admits one connect/reconnect command at a time', async () => {
		const result = deferred();
		const client = {
			getStatus: vi.fn(),
			connect: vi.fn(() => result.promise),
		};
		const controller = new ConnectionController(client);
		controller.state.connection = { status: 'DISCONNECTED' };

		const first = controller.connect();
		const second = controller.connect();
		expect(client.connect).toHaveBeenCalledTimes(1);
		expect(controller.state.pendingAction).toBe('connect');
		result.resolve(connected);
		await Promise.all([first, second]);
		expect(controller.state.connection).toEqual(connected);
		expect(controller.state.pendingAction).toBeNull();
	});

	it('allows reconnect only from RECONNECT_REQUIRED and admits one command', async () => {
		const result = deferred();
		const client = {
			getStatus: vi.fn(),
			connect: vi.fn(() => result.promise),
		};
		const controller = new ConnectionController(client);
		controller.state.connection = { status: 'RECONNECT_REQUIRED' };

		const first = controller.connect();
		const second = controller.connect();
		expect(client.connect).toHaveBeenCalledTimes(1);
		result.resolve(connected);
		await Promise.all([first, second]);
		expect(controller.state.connection).toEqual(connected);
	});

	it('does not allow a stale GET to overwrite a successful POST', async () => {
		const read = deferred();
		const client = {
			getStatus: vi.fn(() => read.promise),
			connect: vi.fn().mockResolvedValue(connected),
		};
		const controller = new ConnectionController(client);
		controller.state.connection = { status: 'DISCONNECTED' };
		const pendingRead = controller.refresh();
		const pendingConnect = controller.connect();
		await pendingConnect;
		read.resolve({ status: 'DISCONNECTED' });
		await pendingRead;
		expect(controller.state.connection).toEqual(connected);
	});

	it('serializes status retries and never turns refresh into credential rotation', async () => {
		const client = {
			getStatus: vi
				.fn()
				.mockResolvedValue({ status: 'REMOTE_UNAVAILABLE' }),
			connect: vi.fn(),
		};
		const controller = new ConnectionController(client);
		await controller.refresh();
		expect(controller.state.connection).toEqual({
			status: 'REMOTE_UNAVAILABLE',
		});
		await controller.refresh();
		expect(client.getStatus).toHaveBeenCalledTimes(2);
		expect(client.connect).not.toHaveBeenCalled();
	});

	it('does not overlap repeated status reads', async () => {
		const result = deferred();
		const client = {
			getStatus: vi.fn(() => result.promise),
			connect: vi.fn(),
		};
		const controller = new ConnectionController(client);
		const first = controller.refresh();
		const second = controller.refresh();

		expect(client.getStatus).toHaveBeenCalledTimes(1);
		result.resolve({ status: 'REMOTE_UNAVAILABLE' });
		await Promise.all([first, second]);
	});

	it('ignores a late completion after the view is disposed', async () => {
		const result = deferred();
		const client = {
			getStatus: vi.fn(),
			connect: vi.fn(() => result.promise),
		};
		const controller = new ConnectionController(client);
		const listener = vi.fn();
		controller.subscribe(listener);
		const pending = controller.connect();
		controller.dispose();
		const updatesAfterDispose = listener.mock.calls.length;
		result.resolve(connected);
		await pending;
		expect(listener).toHaveBeenCalledTimes(updatesAfterDispose);
	});

	it('does not auto-connect when the current site URL has changed', async () => {
		const client = {
			getStatus: vi
				.fn()
				.mockResolvedValue({ status: 'SITE_URL_CHANGED' }),
			connect: vi.fn(),
		};
		const controller = new ConnectionController(client);
		await controller.refresh();
		expect(controller.state.connection).toEqual({
			status: 'SITE_URL_CHANGED',
		});
		expect(client.connect).not.toHaveBeenCalled();
	});

	it('does not admit a connection command from SITE_URL_CHANGED', async () => {
		const client = {
			getStatus: vi.fn(),
			connect: vi.fn(),
		};
		const controller = new ConnectionController(client);
		controller.state.connection = { status: 'SITE_URL_CHANGED' };
		await controller.connect();
		expect(client.connect).not.toHaveBeenCalled();
	});
});
