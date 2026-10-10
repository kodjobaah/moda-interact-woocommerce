import { describe, expect, it, vi } from 'vitest';
import {
	createReadAccessClient,
	parseReadAccessStart,
	parseReadAccessStatus,
} from '../../src/read-access/read-access-client';

const SITE = 'https://woo.example';
const APPROVAL = 'https://woo.example/wc-auth/v1/authorize?scope=read';

const status = (name = 'CONNECTED') => ({
	schemaVersion: 1,
	status: name,
	providerRevocationRequired: false,
});

describe('read-access client', () => {
	it('accepts only bounded server-side grant states and drops unknown fields', () => {
		expect(parseReadAccessStatus(status())).toEqual({
			grantStatus: 'CONNECTED',
			providerRevocationRequired: false,
		});
		expect(() => parseReadAccessStatus({ ...status(), consumerSecret: 'cs_secret' })).toThrow();
		expect(() => parseReadAccessStatus({ ...status(), providerRevocationRequired: true })).toThrow();
	});

	it('does not open an arbitrary origin or write-scoped approval URL', () => {
		const response = { schemaVersion: 1, authorizationUrl: APPROVAL, expiresAt: '2026-10-10T18:00:00Z' };
		expect(parseReadAccessStart(response, SITE)).toBe(APPROVAL);
		expect(() => parseReadAccessStart({ ...response, authorizationUrl: 'https://attacker.example/wc-auth/v1/authorize?scope=read' }, SITE)).toThrow();
		expect(() => parseReadAccessStart({ ...response, authorizationUrl: APPROVAL.replace('read', 'read_write') }, SITE)).toThrow();
		expect(() => parseReadAccessStart({ ...response, credential: 'secret' }, SITE)).toThrow();
	});

	it('uses WordPress REST only with no browser-selected shop or credentials', async () => {
		const request = vi.fn(async ({ method }) => {
			if (method === 'POST') return { schemaVersion: 1, authorizationUrl: APPROVAL, expiresAt: '2026-10-10T18:00:00Z' };
			if (method === 'DELETE') return { schemaVersion: 1, status: 'REVOKED', providerRevocationRequired: true };
			return status();
		});
		const client = createReadAccessClient(request);
		expect(await client.getStatus()).toMatchObject({ grantStatus: 'CONNECTED' });
		expect(await client.start(SITE)).toBe(APPROVAL);
		expect(await client.revoke()).toEqual({ grantStatus: 'REAUTHORIZATION_REQUIRED', providerRevocationRequired: true });
		for (const [params] of request.mock.calls) {
			expect(params.path).toMatch(/^\/moda-interact\/v1\/connection\/read-access/);
			expect(params).not.toHaveProperty('data');
			expect(params).not.toHaveProperty('url');
		}
	});
});
