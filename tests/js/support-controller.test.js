import { describe, expect, it, vi } from 'vitest';
import { SupportController } from '../../src/support/support-controller';
import { createSupportClient } from '../../src/support/support-client';
import {
	countSupportGraphemes,
	validSupportBody,
} from '../../src/support/support-validation';

const message = (id, kind = 'ADMINISTRATIVE') => ({
	id,
	kind,
	state: 'AVAILABLE',
	originalBody: 'Hi',
	displayBody: 'Bonjour',
	isTranslated: true,
	createdAt: '2026-10-16T10:00:00Z',
	readAt: null,
});
const fixtureClient = (overrides = {}) => ({
	capabilities: { read: true, send: true, markRead: true },
	list: vi.fn(async ({ page }) => ({
		items: [message(`message-${page}`)],
		page,
		totalPages: 2,
		unread: 1,
	})),
	markRead: vi.fn(async (id) => ({
		schemaVersion: 1,
		messageId: id,
		readAt: '2026-10-21T10:00:00.000Z',
	})),
	send: vi.fn(async () => ({
		schemaVersion: 1,
		messageId: 'sent-1',
		translationId: null,
	})),
	...overrides,
});
async function settle() {
	for (let tick = 0; tick < 12; tick++) {
		await Promise.resolve();
	}
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

describe('Support controller and Woo transport boundary', () => {
	it('enables the approved authenticated WordPress REST facade without synthetic messages', async () => {
		const request = vi.fn(async () => ({
			schemaVersion: 2,
			page: 1,
			pageSize: 25,
			total: 0,
			totalPages: 1,
			unread: 0,
			items: [],
		}));
		const client = createSupportClient(request);
		const controller = new SupportController(client);
		expect(client.capabilities).toEqual({
			read: true,
			send: true,
			markRead: true,
		});
		controller.setActive(true);
		await settle();
		expect(controller.state).toMatchObject({ status: 'READY', items: [] });
		controller.setActive(false);
	});

	it('paginates real-shaped fixture results and marks only unread system/admin messages', async () => {
		const client = fixtureClient();
		const controller = new SupportController(client);
		controller.setActive(true);
		await settle();
		expect(controller.state.status).toBe('READY');
		expect(controller.state.items[0].readAt).not.toBeNull();
		await controller.goToPage(2);
		expect(controller.state.page).toBe(2);
		expect(client.list).toHaveBeenCalledWith(
			{ page: 2, pageSize: 25 },
			expect.anything()
		);
		controller.goToPage(3);
		expect(client.list).toHaveBeenCalledTimes(2);
		controller.setActive(false);
		expect(controller.state.items).toEqual([]);
	});

	it('handles empty, malformed and failed reads without inventing success', async () => {
		const client = fixtureClient({
			list: vi
				.fn()
				.mockResolvedValueOnce({
					items: [],
					page: 1,
					totalPages: 1,
					unread: 0,
				})
				.mockResolvedValueOnce({
					items: 'invalid',
					page: 1,
					totalPages: 1,
					unread: 0,
				})
				.mockRejectedValueOnce(new Error('offline')),
		});
		const controller = new SupportController(client);
		controller.setActive(true);
		await settle();
		expect(controller.state).toMatchObject({ status: 'READY', items: [] });
		await controller.refresh();
		expect(controller.state.status).toBe('ERROR');
		await controller.refresh();
		expect(controller.state.status).toBe('ERROR');
		const denied = new SupportController(
			fixtureClient({
				list: vi.fn().mockRejectedValue({ code: 'forbidden' }),
			})
		);
		denied.setActive(true);
		await settle();
		expect(denied.state.status).toBe('DENIED');
		denied.setActive(false);
		controller.setActive(false);
	});

	it('shows a strict-v2 contract failure instead of an empty successful inbox', async () => {
		const controller = new SupportController(
			createSupportClient(
				vi.fn(async () => ({
					schemaVersion: 1,
					page: 1,
					pageSize: 25,
					total: 0,
					totalPages: 1,
					unread: 0,
					items: [],
				}))
			)
		);
		controller.setActive(true);
		await settle();
		expect(controller.state.status).toBe('ERROR');
		expect(controller.state.items).toEqual([]);
		controller.setActive(false);
	});

	it('discards superseded reads and responses after disconnect or rotation', async () => {
		const first = deferred();
		const second = deferred();
		const client = fixtureClient({
			list: vi
				.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
		});
		const controller = new SupportController(client);
		controller.setActive(true);
		const abortSignal = client.list.mock.calls[0][1];
		const next = controller.refresh(2);
		expect(abortSignal.aborted).toBe(true);
		first.resolve({
			items: [message('old')],
			page: 1,
			totalPages: 1,
			unread: 1,
		});
		await first.promise;
		expect(controller.state.status).toBe('LOADING');
		controller.setActive(false);
		second.resolve({
			items: [message('new')],
			page: 2,
			totalPages: 2,
			unread: 1,
		});
		await next;
		expect(controller.state.items).toEqual([]);
		expect(controller.state.status).toBe('IDLE');
	});

	it('enforces a single submission and never claims success without service confirmation', async () => {
		const pending = deferred();
		const client = fixtureClient({ send: vi.fn(() => pending.promise) });
		const controller = new SupportController(client);
		controller.setActive(true);
		await settle();
		expect(await controller.send('')).toBe(false);
		expect(controller.state.sendStatus).toBe('INVALID');
		const sending = controller.send('Hello');
		expect(controller.state.sendStatus).toBe('SENDING');
		expect(await controller.send('Hello')).toBe(false);
		expect(client.send).toHaveBeenCalledOnce();
		pending.resolve({ schemaVersion: 1, messageId: null });
		expect(await sending).toBe(false);
		expect(controller.state.sendStatus).toBe('ERROR');
		controller.setActive(false);
	});

	it('counts grapheme clusters as Shopify does, including emoji and combining marks', () => {
		expect(countSupportGraphemes('👩‍💻e\u0301')).toBe(2);
		expect(validSupportBody('👩‍💻'.repeat(500))).toBe(true);
		expect(validSupportBody('👩‍💻'.repeat(501))).toBe(false);
		expect(validSupportBody('')).toBe(false);
	});
});

describe('Woo Support action lifecycle', () => {
	it('reuses a UUID after ambiguous failure, blocks a double click, then clears on ACK', async () => {
		const pending = deferred();
		const send = vi
			.fn()
			.mockImplementationOnce(() => pending.promise)
			.mockResolvedValue({
				schemaVersion: 1,
				messageId: 'msg-1',
				translationId: null,
			});
		const nextId = vi
			.fn()
			.mockReturnValueOnce('uuid-1')
			.mockReturnValueOnce('uuid-2');
		const controller = new SupportController(
			fixtureClient({ send }),
			nextId
		);
		controller.setActive(true);
		await settle();
		const first = controller.send('Please help');
		expect(await controller.send('Please help')).toBe(false);
		pending.reject(new Error('timeout'));
		expect(await first).toBe(false);
		expect(controller.state.sendStatus).toBe('ERROR');
		expect(await controller.send('Please help')).toBe(true);
		expect(send.mock.calls.slice(0, 2).map((args) => args[1])).toEqual([
			'uuid-1',
			'uuid-1',
		]);
		expect(nextId).toHaveBeenCalledOnce();
		await settle();
		expect(await controller.send('New message')).toBe(true);
		expect(send.mock.calls[2][1]).toBe('uuid-2');
		controller.setActive(false);
	});

	it('applies durable SYSTEM read timestamp and never exposes unauthorized data', async () => {
		const system = message('consent-notice', 'SYSTEM');
		const client = fixtureClient({
			list: vi.fn(async () => ({
				items: [system],
				page: 1,
				totalPages: 1,
				unread: 1,
			})),
		});
		const controller = new SupportController(client);
		controller.setActive(true);
		await settle();
		expect(client.markRead).toHaveBeenCalledWith(
			'consent-notice',
			expect.anything()
		);
		expect(controller.state.items[0].readAt).toBe(
			'2026-10-21T10:00:00.000Z'
		);
		expect(controller.state.unread).toBe(0);
		controller.setActive(false);
	});

	it('aborts an in-flight send on unmount and discards its stale ACK', async () => {
		const pending = deferred();
		const client = fixtureClient({ send: vi.fn(() => pending.promise) });
		const controller = new SupportController(client, () => 'uuid-1');
		controller.setActive(true);
		await settle();
		const started = controller.send('Message');
		const signal = client.send.mock.calls[0][2];
		controller.setActive(false);
		expect(signal.aborted).toBe(true);
		pending.resolve({
			schemaVersion: 1,
			messageId: 'stale-1',
			translationId: null,
		});
		expect(await started).toBe(false);
		expect(controller.state.sendStatus).toBe('IDLE');
		expect(controller.state.items).toEqual([]);
	});

	it('locks a revoked/denied Support session and does not issue sends', async () => {
		const client = fixtureClient({
			list: vi.fn().mockRejectedValue({ code: 'connection_unavailable' }),
		});
		const controller = new SupportController(client);
		controller.setActive(true);
		await settle();
		expect(controller.state.status).toBe('UNAVAILABLE');
		expect(await controller.send('Never send')).toBe(false);
		expect(client.send).not.toHaveBeenCalled();
		controller.setActive(false);
	});
});

describe('Suspended shop Support access', () => {
	it('keeps read history and mark-read active while disabling suspended-shop compose', async () => {
		const client = fixtureClient({
			send: vi.fn().mockRejectedValue({ code: 'send_unavailable' }),
		});
		const controller = new SupportController(client, () => 'action-1');
		controller.setActive(true);
		await settle();
		expect(await controller.send('Hello')).toBe(false);
		expect(controller.state.status).toBe('READY');
		expect(controller.state.items).toHaveLength(1);
		expect(controller.state.sendBlocked).toBe(true);
		expect(await controller.send('Hello')).toBe(false);
		expect(client.send).toHaveBeenCalledOnce();
		controller.setActive(false);
	});
});
