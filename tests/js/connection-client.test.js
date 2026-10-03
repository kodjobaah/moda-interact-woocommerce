import { describe, expect, it, vi } from 'vitest';
import {
	CONNECTION_PATH,
	createConnectionClient,
	parseConnectionCommand,
	parseConnectionStatus,
} from '../../src/connection-client';

const connected = {
	status: 'CONNECTED',
	installationId: 'install_safe',
	shopId: 'shop_safe',
	canonicalSiteUrl: 'https://merchant.example/store',
	credentialVersion: 2,
};

describe('connection client', () => {
	it.each([
		' DISCONNECTED',
		'RECONNECT_REQUIRED',
		'SITE_URL_CHANGED',
		'REMOTE_UNAVAILABLE',
		'API_NOT_CONFIGURED',
		'LOCAL_STATE_INVALID',
	])('accepts the bounded %s response', (status) => {
		const normalizedStatus = status.trim();
		expect(parseConnectionStatus({ status: normalizedStatus })).toEqual({
			status: normalizedStatus,
		});
	});

	it('accepts connected safe metadata and rejects unknown, malformed, or secret-bearing data', () => {
		expect(parseConnectionStatus(connected)).toEqual(connected);
		expect(() => parseConnectionStatus({ status: 'CONNECTED' })).toThrow();
		expect(() =>
			parseConnectionStatus({ status: 'FUTURE_STATUS' })
		).toThrow();
		expect(() =>
			parseConnectionStatus({
				...connected,
				credential: 'must-not-enter-state',
			})
		).toThrow();
		expect(() =>
			parseConnectionStatus({
				...connected,
				canonicalSiteUrl: 'javascript:alert(1)',
			})
		).toThrow();
	});

	it('accepts only the bounded connect/reconnect response shape', () => {
		expect(
			parseConnectionCommand({ ...connected, connection: 'RECONNECTED' })
		).toEqual(connected);
		expect(() =>
			parseConnectionCommand({
				...connected,
				connection: 'CREATED',
				credentialDigest: 'secret',
			})
		).toThrow();
	});

	it('uses only the local WordPress GET and POST routes without a body', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce({ status: 'DISCONNECTED' })
			.mockResolvedValueOnce({
				...connected,
				connection: 'CREATED',
			});
		const client = createConnectionClient(request);

		await client.getStatus();
		await client.connect();

		expect(request).toHaveBeenNthCalledWith(1, {
			path: CONNECTION_PATH,
			method: 'GET',
		});
		expect(request).toHaveBeenNthCalledWith(2, {
			path: CONNECTION_PATH,
			method: 'POST',
		});
	});

	it('preserves recognized WOO-003 error-status bodies but normalizes transport failures', async () => {
		const apiNotConfigured = createConnectionClient(
			vi.fn().mockRejectedValue({ status: 'API_NOT_CONFIGURED' })
		);
		const transportFailure = createConnectionClient(
			vi.fn().mockRejectedValue(new Error('private transport detail'))
		);

		await expect(apiNotConfigured.getStatus()).resolves.toEqual({
			status: 'API_NOT_CONFIGURED',
		});
		await expect(transportFailure.getStatus()).rejects.toThrow(
			'connection_request_failed'
		);
	});
});
