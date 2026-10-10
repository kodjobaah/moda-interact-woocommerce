import { describe, expect, it, vi } from 'vitest';
import { ReadAccessController } from '../../src/read-access/read-access-controller';

const connected = (id = 'a', version = 1) => ({
	status: 'CONNECTED', installationId: id, shopId: id,
	credentialVersion: version, canonicalSiteUrl: 'https://woo.example',
});
const grant = (grantStatus) => ({ grantStatus, providerRevocationRequired: false });

describe('read-access controller', () => {
	it('loads after installation connect, then starts explicit approval without modifying connect', async () => {
		const client = {
			getStatus: vi.fn(async () => grant('NOT_CONNECTED')),
			start: vi.fn(async () => 'https://woo.example/wc-auth/v1/authorize?scope=read'),
			revoke: vi.fn(),
		};
		const controller = new ReadAccessController(client);
		controller.setConnection(connected());
		await controller.readPromise;
		expect(controller.state.grantStatus).toBe('NOT_CONNECTED');
		await controller.start();
		expect(client.start).toHaveBeenCalledWith('https://woo.example');
		expect(controller.state.grantStatus).toBe('PENDING');
		expect(controller.state.authorizationUrl).toContain('scope=read');
		controller.dispose();
	});

	it('never publishes a stale result from an earlier installation generation', async () => {
		let finish;
		const client = { getStatus: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(grant('CONNECTED')) };
		const controller = new ReadAccessController(client);
		controller.setConnection(connected('first'));
		controller.setConnection(connected('second'));
		await controller.readPromise;
		finish(grant('NOT_CONNECTED'));
		await Promise.resolve();
		expect(controller.state.grantStatus).toBe('CONNECTED');
		controller.dispose();
	});

	it('distinguishes incomplete approval from an untouched shop', async () => {
		const client = { getStatus: vi.fn().mockResolvedValueOnce(grant('PENDING')).mockResolvedValueOnce(grant('NOT_CONNECTED')) };
		const controller = new ReadAccessController(client);
		controller.setConnection(connected());
		await controller.readPromise;
		await controller.refresh();
		expect(controller.state.approvalNotCompleted).toBe(true);
		controller.dispose();
	});

	it('revokes independently and blocks double submission', async () => {
		let finish;
		const client = {
			getStatus: vi.fn(async () => grant('CONNECTED')),
			revoke: vi.fn(() => new Promise(resolve => { finish = resolve; })),
		};
		const controller = new ReadAccessController(client);
		controller.setConnection(connected());
		await controller.readPromise;
		const first = controller.revoke();
		controller.revoke();
		expect(client.revoke).toHaveBeenCalledTimes(1);
		finish({ grantStatus: 'REAUTHORIZATION_REQUIRED', providerRevocationRequired: true });
		await first;
		expect(controller.state.grantStatus).toBe('REAUTHORIZATION_REQUIRED');
		expect(controller.state.providerRevocationRequired).toBe(true);
		controller.dispose();
	});
});
