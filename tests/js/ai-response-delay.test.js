import { describe, expect, it, vi } from 'vitest';
import {
	AI_RESPONSE_DELAY_PATH,
	createAiResponseDelayClient,
	makeAiResponseDelayUpdate,
	parseAiResponseDelay,
} from '../../src/ai-response-delay-client';
import { AiResponseDelayController } from '../../src/ai-response-delay-controller';

const initial = {
	schemaVersion: 1,
	revision: 'UNCONFIGURED',
	aiResponseDelayMinutes: 0,
};

const saved = {
	schemaVersion: 1,
	revision: '2026-10-31T16:28:55.123Z',
	aiResponseDelayMinutes: 7,
};

async function settle() {
	for (let index = 0; index < 12; index++) {
		await Promise.resolve();
	}
}

describe('ARCH-054 WooCommerce AI response delay client', () => {
	it('accepts whole-minute boundaries and rejects invalid or extended wire data', () => {
		for (const value of [0, 1, 7, 30]) {
			expect(
				parseAiResponseDelay({
					...initial,
					aiResponseDelayMinutes: value,
				}).aiResponseDelayMinutes
			).toBe(value);
		}
		for (const value of [-1, 31, 0.5, '7', null]) {
			expect(() =>
				parseAiResponseDelay({
					...initial,
					aiResponseDelayMinutes: value,
				})
			).toThrow('REMOTE_RESPONSE_INVALID');
		}
		expect(() =>
			parseAiResponseDelay({ ...initial, unexpected: true })
		).toThrow('REMOTE_RESPONSE_INVALID');
		expect(() =>
			parseAiResponseDelay({ ...initial, revision: 'not-a-revision' })
		).toThrow('REMOTE_RESPONSE_INVALID');
	});

	it('builds only the exact Shared v1 write and rejects invalid drafts', () => {
		expect(
			makeAiResponseDelayUpdate(initial, { aiResponseDelayMinutes: '30' })
		).toEqual({
			schemaVersion: 1,
			expectedRevision: 'UNCONFIGURED',
			aiResponseDelayMinutes: 30,
		});
		for (const value of ['-1', '31', '1.5', '7x', '']) {
			expect(() =>
				makeAiResponseDelayUpdate(initial, {
					aiResponseDelayMinutes: value,
				})
			).toThrow('INVALID_REQUEST');
		}
	});

	it('uses only the protected WordPress route and reads canonical state after save', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(initial)
			.mockResolvedValueOnce(saved)
			.mockResolvedValueOnce(saved);
		const client = createAiResponseDelayClient(request);
		expect(await client.read()).toEqual(initial);
		expect(
			await client.save(
				makeAiResponseDelayUpdate(initial, {
					aiResponseDelayMinutes: '7',
				})
			)
		).toEqual(saved);
		expect(request).toHaveBeenNthCalledWith(1, {
			path: AI_RESPONSE_DELAY_PATH,
			method: 'GET',
		});
		expect(request).toHaveBeenNthCalledWith(2, {
			path: AI_RESPONSE_DELAY_PATH,
			method: 'PUT',
			data: {
				schemaVersion: 1,
				expectedRevision: 'UNCONFIGURED',
				aiResponseDelayMinutes: 7,
			},
		});
		expect(request).toHaveBeenNthCalledWith(3, {
			path: AI_RESPONSE_DELAY_PATH,
			method: 'GET',
		});
		expect(JSON.stringify(request.mock.calls)).not.toContain('credential');
		expect(JSON.stringify(request.mock.calls)).not.toContain('shopId');
	});

	it('reconciles an ambiguous failed write from a fresh read only', async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce(new Error('network timeout'))
			.mockResolvedValueOnce(saved);
		const client = createAiResponseDelayClient(request);
		await expect(
			client.save({ aiResponseDelayMinutes: 7 })
		).resolves.toEqual(saved);
		expect(request).toHaveBeenCalledTimes(2);

		const notSaved = vi
			.fn()
			.mockRejectedValueOnce(new Error('network timeout'))
			.mockResolvedValueOnce(initial);
		await expect(
			createAiResponseDelayClient(notSaved).save({
				aiResponseDelayMinutes: 7,
			})
		).rejects.toThrow('REMOTE_UNAVAILABLE');
	});
});

describe('ARCH-054 WooCommerce AI response delay controller', () => {
	it('loads the persisted value on activation and saves the verified canonical value', async () => {
		const client = {
			read: vi
				.fn()
				.mockResolvedValueOnce(initial)
				.mockResolvedValueOnce(saved),
			save: vi.fn().mockResolvedValue(saved),
		};
		const controller = new AiResponseDelayController(client);
		controller.setConnectionStatus('CONNECTED');
		controller.setActive(true);
		await settle();
		expect(controller.state).toEqual({ status: 'READY', data: initial });
		await controller.save({ aiResponseDelayMinutes: '7' });
		expect(client.save).toHaveBeenCalledWith({
			schemaVersion: 1,
			expectedRevision: 'UNCONFIGURED',
			aiResponseDelayMinutes: 7,
		});
		expect(controller.state).toEqual({ status: 'SAVED', data: saved });
		controller.dispose();
	});

	it('surfaces revision conflicts and retains the prior canonical value', async () => {
		const client = {
			read: vi.fn().mockResolvedValue(initial),
			save: vi
				.fn()
				.mockRejectedValue(new Error('AI_RESPONSE_DELAY_CONFLICT')),
		};
		const controller = new AiResponseDelayController(client);
		controller.setConnectionStatus('CONNECTED');
		controller.setActive(true);
		await settle();
		await controller.save({ aiResponseDelayMinutes: '7' });
		expect(controller.state).toEqual({ status: 'CONFLICT', data: initial });
		controller.dispose();
	});
});
