import { describe, expect, it, vi } from 'vitest';
import {
	createSupportClient,
	supportTransportError,
} from '../../src/support/support-client';
import {
	parseComposeReceipt,
	parseReadReceipt,
	parseSupportPage,
	SUPPORT_PATH,
} from '../../src/support/support-contract';
import { supportSystemHref } from '../../src/support/support-message-card';

const message = (kind = 'ADMINISTRATIVE') => ({
	id: 'msg-1',
	kind,
	state: 'AVAILABLE',
	originalBody: 'Hello',
	displayBody: 'Bonjour',
	isTranslated: true,
	sourceLanguageTag: 'en',
	displayLanguageTag: 'fr',
	systemCode: kind === 'SYSTEM' ? 'BILLING_PLAN_UPGRADED' : null,
	systemVersion: kind === 'SYSTEM' ? '1' : null,
	checkoutRecoveryId: null,
	createdAt: '2026-10-21T10:00:00Z',
	readAt: null,
});
const page = (
	items = [message('MERCHANT'), message('ADMINISTRATIVE'), message('SYSTEM')]
) => ({
	schemaVersion: 2,
	page: 1,
	pageSize: 25,
	total: items.length,
	totalPages: 1,
	unread: 2,
	items,
});

describe('ARCH-035-WOOCOMMERCE-016 privileged Support client', () => {
	it('reads paginated MERCHANT/ADMIN/SYSTEM history from WordPress REST only', async () => {
		const request = vi.fn(async () => page());
		const client = createSupportClient(request);
		const signal = new AbortController().signal;
		const result = await client.list({ page: 1, pageSize: 25 }, signal);
		expect(result.items).toHaveLength(3);
		expect(result.unread).toBe(2);
		expect(request).toHaveBeenCalledWith({
			path: `${SUPPORT_PATH}?page=1&pageSize=25`,
			method: 'GET',
			signal,
		});
		expect(supportSystemHref(result.items[2])).toBe(
			'admin.php?page=moda-interact-billing'
		);
		expect(request.mock.calls[0][0]).not.toHaveProperty('headers');
	});

	it('sends only approved body and stable actionId, and uses the remote receipt', async () => {
		const request = vi.fn(async () => ({
			schemaVersion: 1,
			messageId: 'new-message',
			translationId: 'translation-1',
		}));
		const client = createSupportClient(request);
		const signal = new AbortController().signal;
		const body = '👩‍💻'.repeat(500);
		expect(await client.send(body, 'stable-uuid', signal)).toEqual({
			schemaVersion: 1,
			messageId: 'new-message',
			translationId: 'translation-1',
		});
		expect(request).toHaveBeenCalledWith({
			path: SUPPORT_PATH,
			method: 'POST',
			data: { body, actionId: 'stable-uuid' },
			signal,
		});
		expect(request.mock.calls[0][0].data).not.toHaveProperty('shopId');
		await expect(
			client.send('👩‍💻'.repeat(501), 'stable-uuid')
		).rejects.toThrow('invalid_request');
		await expect(client.send('Hello', 'invalid/action')).rejects.toThrow(
			'invalid_request'
		);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('marks read using an empty POST body and durable hosted timestamp', async () => {
		const request = vi.fn(async () => ({
			schemaVersion: 1,
			messageId: 'msg-1',
			readAt: '2026-10-21T12:00:00.000Z',
		}));
		const client = createSupportClient(request);
		expect(await client.markRead('msg-1')).toEqual({
			schemaVersion: 1,
			messageId: 'msg-1',
			readAt: '2026-10-21T12:00:00.000Z',
		});
		expect(request).toHaveBeenCalledWith({
			path: `${SUPPORT_PATH}/msg-1/read`,
			method: 'POST',
			signal: undefined,
		});
		await expect(client.markRead('wrong/id')).rejects.toThrow(
			'invalid_request'
		);
	});

	it('rejects unexpected hosted attributes, malformed messages and forged ACKs', async () => {
		for (const invalid of [
			{ ...page(), credential: 'secret' },
			{
				...page(),
				items: [{ ...message('SYSTEM'), href: 'https://bad.invalid' }],
			},
			{ ...page(), items: [{ ...message(), kind: 'UNKNOWN' }] },
			{ ...page(), items: [{ ...message(), readAt: 'yesterday' }] },
			{ ...page(), schemaVersion: 1 },
			{ ...page(), schemaVersion: 3 },
			{
				...page(),
				items: [{ ...message(), checkoutRecoveryId: 'bad/id' }],
			},
			{
				...page(),
				items: [{ ...message(), checkoutRecoveryId: 'msg-1\n' }],
			},
			{
				...page(),
				items: [{ ...message(), checkoutRecoveryId: undefined }],
			},
		]) {
			expect(() => parseSupportPage(invalid, 1, 25)).toThrow(
				'remote_response_invalid'
			);
		}
		await expect(
			createSupportClient(vi.fn(async () => ({ sent: true }))).send(
				'Hello',
				'action-1'
			)
		).rejects.toThrow('remote_response_invalid');
		await expect(
			createSupportClient(
				vi.fn(async () => ({
					schemaVersion: 1,
					messageId: 'foreign',
					readAt: '2026-10-21T12:00:00Z',
				}))
			).markRead('msg-1')
		).rejects.toThrow('remote_response_invalid');
	});

	it('requires v2 for history while preserving v1 compose and read receipts', () => {
		expect(parseSupportPage(page(), 1, 25).schemaVersion).toBe(2);
		expect(
			parseComposeReceipt({
				schemaVersion: 1,
				messageId: 'new-message',
				translationId: null,
			}).schemaVersion
		).toBe(1);
		expect(
			parseReadReceipt(
				{
					schemaVersion: 1,
					messageId: 'msg-1',
					readAt: '2026-10-21T12:00:00Z',
				},
				'msg-1'
			).schemaVersion
		).toBe(1);
	});

	it('maps only safe permission, connection, conflict and transport error codes', () => {
		expect(
			supportTransportError({
				data: { status: 401 },
				code: 'unauthorized',
			}).code
		).toBe('connection_unavailable');
		expect(
			supportTransportError({
				data: { status: 403 },
				code: 'rest_forbidden',
			}).code
		).toBe('forbidden');
		expect(
			supportTransportError({ status: 'RECONNECT_REQUIRED' }).code
		).toBe('connection_unavailable');
		expect(
			supportTransportError({ status: 'SUPPORT_UNAVAILABLE' }).code
		).toBe('send_unavailable');
		expect(supportTransportError({ code: 'ACTION_CONFLICT' }).code).toBe(
			'idempotency_conflict'
		);
		expect(
			supportTransportError(new Error('redis password=secret')).message
		).toBe('remote_unavailable');
	});
});
