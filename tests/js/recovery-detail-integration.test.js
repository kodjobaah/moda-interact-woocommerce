import { describe, it, expect, vi } from 'vitest';
import { createRecoveryDetailClient } from '../../src/recoveries/detail/api/recovery-detail-client';
import { parseRecoveryDetailResponse } from '../../src/recoveries/detail/api/recovery-detail-contract';
import { RecoveryDetailController } from '../../src/recoveries/detail/recovery-detail-controller';
import {
	detailSummaryDisplay,
	detailMessagesDisplay,
	detailRelatedDisplay,
} from '../../src/recoveries/detail/recovery-detail-presentation';

const summary = {
	schemaVersion: 1,
	id: 'rec_1',
	status: 'COMPLETED',
	timeZone: 'Europe/London',
	value: { amount: '89.99', currency: 'GBP', incomplete: false },
	customer: {
		firstName: 'Ada',
		lastName: 'Lovelace',
		email: 'ada@example.invalid',
	},
	hasConversation: true,
	milestones: {
		detectedAt: '2026-10-09T12:00:00.000Z',
		messageSentAt: '2026-10-09T13:00:00.000Z',
		engagedAt: null,
		completedAt: '2026-10-09T14:00:00.000Z',
		expiredAt: null,
	},
};
const message = {
	id: 'msg_1',
	createdAt: '2026-10-09T13:00:00.000Z',
	direction: 'OUTBOUND',
	sender: 'AGENT',
	content: {
		type: 'TEXT',
		text: 'Hi, see https://example.test',
		transcriptionStatus: null,
	},
	delivery: {
		status: 'DELIVERED',
		sentAt: '2026-10-09T13:00:00.000Z',
		deliveredAt: '2026-10-09T13:00:02.000Z',
		readAt: null,
	},
};
const messages = {
	schemaVersion: 1,
	previousCursor: null,
	nextCursor: 'next_m1',
	items: [message],
};
const related = {
	schemaVersion: 1,
	previousCursor: null,
	nextCursor: 'next_r1',
	items: [
		{
			id: 'rec_2',
			status: 'COMPLETED',
			detectedAt: '2026-10-02T12:00:00.000Z',
			value: { amount: '49.99', currency: 'GBP', incomplete: false },
		},
	],
};

async function settle() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
}

describe('ARCH-035 API-013 WordPress detail integration', () => {
	it('performs privileged WordPress REST reads with section-scoped cursor pagination', async () => {
		const request = vi.fn(async ({ path }) => {
			if (path.endsWith('/messages?cursor=next_m1')) {
				return {
					...messages,
					nextCursor: null,
					previousCursor: 'prev_m2',
				};
			}
			if (path.includes('/messages')) {
				return messages;
			}
			if (path.includes('/related')) {
				return related;
			}
			return summary;
		});
		const client = createRecoveryDetailClient(request);
		expect(await client.summary('rec_1')).toEqual(summary);
		await client.messages('rec_1', { cursor: 'next_m1' });
		await client.related('rec_1', { cursor: 'next_r1' });
		expect(request.mock.calls.map(([args]) => args.path)).toEqual([
			'/moda-interact/v1/merchant/recoveries/rec_1',
			'/moda-interact/v1/merchant/recoveries/rec_1/messages?cursor=next_m1',
			'/moda-interact/v1/merchant/recoveries/rec_1/related?cursor=next_r1',
		]);
		expect(
			request.mock.calls.every(([args]) => args.method === 'GET')
		).toBe(true);
		await expect(
			client.messages('rec_1', { cursor: '../other' })
		).rejects.toThrow('invalid_request');
		await expect(
			client.related('rec_1', { window: 'latest' })
		).rejects.toThrow('invalid_request');
		await expect(client.summary('wrong/id')).rejects.toThrow(
			'invalid_request'
		);
		expect(request).toHaveBeenCalledTimes(3);
	});

	it('rejects extra customer/provider fields, oversized pages and foreign summary identities', async () => {
		expect(() =>
			parseRecoveryDetailResponse('summary', {
				...summary,
				accessToken: 'secret',
			})
		).toThrow();
		expect(() =>
			parseRecoveryDetailResponse('messages', {
				...messages,
				items: [{ ...message, shopId: 'another-shop' }],
			})
		).toThrow();
		expect(() =>
			parseRecoveryDetailResponse('related', {
				...related,
				items: Array(6).fill(related.items[0]),
			})
		).toThrow();
		const client = createRecoveryDetailClient(async () => ({
			...summary,
			id: 'foreign_id',
		}));
		await expect(client.summary('rec_1')).rejects.toThrow(
			'remote_unavailable'
		);
	});

	it('formats summary/message/related read models without inventing monetary values or timestamps', () => {
		const display = detailSummaryDisplay(summary, 'en-GB');
		expect(display.customerName).toBe('Ada Lovelace');
		expect(display.checkoutValue).toMatch(/£89\.99/);
		expect(display.milestones.started).toBeTruthy();
		expect(display.milestones.engaged).toBeNull();
		expect(
			detailSummaryDisplay({
				...summary,
				value: { amount: null, currency: 'GBP', incomplete: true },
			}).checkoutValue
		).toBeNull();
		const shown = detailMessagesDisplay(
			[message],
			'Europe/London',
			'en-GB'
		)[0];
		expect(shown.sender).toBe('assistant');
		expect(shown.direction).toBe('outbound');
		expect(shown.deliveryStatus).toBe('Delivered');
		expect(
			detailRelatedDisplay(related.items, 'Europe/London')[0]
				.checkoutValue
		).toMatch(/£49\.99/);
	});

	it('loads summary first, then independently paginates conversation and related recoveries', async () => {
		const client = {
			summary: vi.fn(async () => summary),
			messages: vi.fn(async (_id, navigation) =>
				navigation?.cursor
					? {
							...messages,
							previousCursor: 'prev_m2',
							nextCursor: null,
						}
					: messages
			),
			related: vi.fn(async (_id, navigation) =>
				navigation?.cursor
					? {
							...related,
							previousCursor: 'prev_r2',
							nextCursor: null,
						}
					: related
			),
		};
		const controller = new RecoveryDetailController('rec_1', client);
		controller.setActive(true);
		await settle();
		expect(controller.state.summary.status).toBe('READY');
		expect(controller.state.messages.status).toBe('READY');
		expect(controller.state.related.status).toBe('READY');
		await controller.goMessages('next');
		expect(client.messages).toHaveBeenLastCalledWith(
			'rec_1',
			{ cursor: 'next_m1' },
			expect.anything()
		);
		expect(controller.state.related.data).toBe(related);
		await controller.goRelated('next');
		expect(client.related).toHaveBeenLastCalledWith(
			'rec_1',
			{ cursor: 'next_r1' },
			expect.anything()
		);
		expect(controller.state.messages.data.previousCursor).toBe('prev_m2');
		await controller.jumpLatest();
		expect(client.messages).toHaveBeenLastCalledWith(
			'rec_1',
			{ window: 'latest' },
			expect.anything()
		);
		controller.setActive(false);
	});

	it('drops stale cancelled responses on unmount or when a later cursor request wins', async () => {
		let resolveFirst;
		const first = new Promise((resolve) => {
			resolveFirst = resolve;
		});
		const client = {
			summary: vi.fn(async () => summary),
			messages: vi.fn((_id, nav) =>
				nav?.window === 'latest' ? Promise.resolve(messages) : first
			),
			related: vi.fn(async () => related),
		};
		const controller = new RecoveryDetailController('rec_1', client);
		controller.setActive(true);
		await settle();
		await controller.loadMessages({ window: 'latest' });
		resolveFirst({ ...messages, items: [] });
		await settle();
		expect(controller.state.messages.data.items).toHaveLength(1);
		controller.setActive(false);
		expect(controller.state.messages.status).toBe('IDLE');
	});

	it('rejects unknown recovery identifiers without any network read', () => {
		const client = {
			summary: vi.fn(),
			messages: vi.fn(),
			related: vi.fn(),
		};
		const controller = new RecoveryDetailController(null, client);
		controller.setActive(true);
		expect(controller.state.summary.status).toBe('NOT_FOUND');
		expect(client.summary).not.toHaveBeenCalled();
	});
});
