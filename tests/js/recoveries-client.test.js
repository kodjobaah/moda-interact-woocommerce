import { describe, expect, it, vi } from 'vitest';
import {
	createRecoveriesClient,
	RECOVERIES_REST_PATH,
} from '../../src/recoveries/api/recoveries-client';
import { parseRecoveriesResponse } from '../../src/recoveries/api/recoveries-contract';

const row = {
	id: 'rec_1',
	status: 'COMPLETED',
	detectedAt: '2026-10-10T12:00:00.000Z',
	lastActivityAt: '2026-10-10T13:00:00.000Z',
	totalPrice: '12.50',
	currency: 'GBP',
	customer: { displayName: 'Ada Lovelace', email: 'ada@example.invalid' },
};
const page = {
	schemaVersion: 1,
	timeZone: 'Europe/London',
	from: '2026-10-01',
	to: '2026-10-11',
	q: 'Ada',
	status: 'COMPLETED',
	page: 2,
	pageSize: 10,
	total: 12,
	totalPages: 2,
	hasPrevious: true,
	hasNext: false,
	items: [row],
};

describe('Recoveries read-only client', () => {
	it('forwards only filters/pagination to the privileged WordPress REST endpoint', async () => {
		const request = vi.fn().mockResolvedValue(page);
		const controller = new AbortController();
		const result = await createRecoveriesClient(request).list(
			{
				page: 2,
				pageSize: 10,
				from: page.from,
				to: page.to,
				q: 'Ada',
				status: 'COMPLETED',
			},
			controller.signal
		);
		expect(result).toEqual(page);
		expect(request).toHaveBeenCalledOnce();
		const options = request.mock.calls[0][0];
		expect(options.method).toBe('GET');
		expect(options.signal).toBe(controller.signal);
		expect(options.path.split('?')[0]).toBe(RECOVERIES_REST_PATH);
		expect(
			Object.fromEntries(new URLSearchParams(options.path.split('?')[1]))
		).toEqual({
			page: '2',
			pageSize: '10',
			from: page.from,
			to: page.to,
			q: 'Ada',
			status: 'COMPLETED',
		});
		expect(options).not.toHaveProperty('headers');
	});

	it('rejects unexpected identity and sensitive fields, pagination mismatches and bad states', async () => {
		for (const payload of [
			{ ...page, shopId: 'foreign' },
			{ ...page, items: [{ ...row, phone: '+4412345678' }] },
			{ ...page, hasNext: true },
			{ ...page, totalPages: 300 },
			{ ...page, pageSize: 11 },
		]) {
			expect(() => parseRecoveriesResponse(payload)).toThrow(
				'remote_response_invalid'
			);
		}
		const request = vi.fn().mockResolvedValue({
			...page,
			page: 1,
			hasPrevious: false,
			hasNext: true,
		});
		await expect(
			createRecoveriesClient(request).list({
				page: 2,
				pageSize: 10,
				from: page.from,
				to: page.to,
				q: 'Ada',
				status: 'COMPLETED',
			})
		).resolves.toMatchObject({ page: 1, totalPages: 2 });
		await expect(
			createRecoveriesClient(request).list({ page: 0 })
		).rejects.toThrow('invalid_request');
		expect(request).toHaveBeenCalledOnce();
	});

	it('rejects response changes to requested filters and never leaks server error messages', async () => {
		const mismatch = vi.fn().mockResolvedValue({ ...page, status: 'all' });
		await expect(
			createRecoveriesClient(mismatch).list({
				page: 2,
				pageSize: 10,
				from: page.from,
				to: page.to,
				q: 'Ada',
				status: 'COMPLETED',
			})
		).rejects.toThrow('remote_unavailable');
		const broken = vi
			.fn()
			.mockRejectedValue(new Error('sensitive hosted error'));
		await expect(
			createRecoveriesClient(broken).list({ page: 1 })
		).rejects.toThrow('remote_unavailable');
	});
});
