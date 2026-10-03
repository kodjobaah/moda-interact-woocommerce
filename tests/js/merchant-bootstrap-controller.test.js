import { describe, expect, it, vi } from 'vitest';
import { MerchantBootstrapController } from '../../src/merchant-bootstrap-controller';

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe('MerchantBootstrapController', () => {
	it('does not load until CONNECTED, and refresh remains single-flight', async () => {
		const result = deferred();
		const client = { getMerchantBootstrap: vi.fn(() => result.promise) };
		const controller = new MerchantBootstrapController(client);

		await controller.refresh();
		expect(client.getMerchantBootstrap).not.toHaveBeenCalled();
		controller.setConnectionStatus('CONNECTED');
		const first = controller.refresh();
		const second = controller.refresh();
		expect(client.getMerchantBootstrap).toHaveBeenCalledTimes(1);
		result.resolve({ shop: { onboardingCompleted: false } });
		await Promise.all([first, second]);
		expect(controller.state.status).toBe('READY');
	});

	it('hides stale bootstrap data as soon as connection leaves CONNECTED', async () => {
		const result = deferred();
		const controller = new MerchantBootstrapController({
			getMerchantBootstrap: () => result.promise,
		});
		controller.setConnectionStatus('CONNECTED');
		controller.setConnectionStatus('RECONNECT_REQUIRED');
		expect(controller.state).toEqual({ status: 'IDLE' });
		result.resolve({ shop: { onboardingCompleted: false } });
		await controller.requestPromise;
		expect(controller.state).toEqual({ status: 'IDLE' });
	});

	it('hands remote authentication rejection back to the connection controller', async () => {
		const onConnectionAttention = vi.fn();
		const controller = new MerchantBootstrapController(
			{
				getMerchantBootstrap: async () => {
					throw new Error('RECONNECT_REQUIRED');
				},
			},
			onConnectionAttention
		);
		controller.setConnectionStatus('CONNECTED');
		await controller.requestPromise;
		expect(controller.state.status).toBe('RECONNECT_REQUIRED');
		expect(onConnectionAttention).toHaveBeenCalledTimes(1);
	});

	it('keeps outages retryable without changing the connection or onboarding state', async () => {
		const client = {
			getMerchantBootstrap: vi
				.fn()
				.mockRejectedValueOnce(new Error('REMOTE_UNAVAILABLE'))
				.mockResolvedValue({ shop: { onboardingCompleted: false } }),
		};
		const controller = new MerchantBootstrapController(client);
		controller.setConnectionStatus('CONNECTED');
		await controller.requestPromise;
		expect(controller.state.status).toBe('REMOTE_UNAVAILABLE');
		await controller.refresh();
		expect(controller.state.data.shop.onboardingCompleted).toBe(false);
		expect(client.getMerchantBootstrap).toHaveBeenCalledTimes(2);
	});
});
