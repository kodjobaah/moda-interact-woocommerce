import { describe, it, expect, vi } from 'vitest';
import { createKnowledgeUploader } from '../../src/recovery-settings/merchant-knowledge/knowledge-upload-transport';

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const DIGEST = 'a'.repeat(64);
const URL_BASE =
	'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/knowledge-assets/merchant-knowledge/test-1/woocommerce/shop_1/asset_1/source.csv';
const SIGNED = `${URL_BASE}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=example&X-Amz-Date=20261019T120000Z&X-Amz-Expires=60&X-Amz-SignedHeaders=content-type%3Bhost%3Bif-none-match%3Bx-amz-meta-sha256&X-Amz-Signature=${'b'.repeat(64)}`;
const CURRENT_ASSET = '550e8400-e29b-41d4-a716-446655440000';
const CURRENT_SIGNED = SIGNED.replace(
	'/asset_1/source.csv',
	`/store.example.com/20261019T120000000Z-${CURRENT_ASSET}.csv`
);
const file = () => ({
	name: 'faq.csv',
	size: 4,
	type: 'text/csv',
	arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
});
const payload = () => ({
	name: 'FAQ',
	purpose: 'FAQ',
	languageTag: 'en',
	dataFormatKey: 'CSV',
	file: file(),
	maxUploadBytes: 1024,
	catalogue: [
		{
			purpose: { key: 'FAQ' },
			dataFormat: {
				key: 'CSV',
				inputKind: 'UPLOAD',
				acceptedContentTypes: ['text/csv'],
			},
		},
	],
});
const intent = () => ({
	schemaVersion: 1,
	assetId: 'asset_1',
	uploadUrl: SIGNED,
	expiresAt: new Date(NOW + 60000).toISOString(),
	maxUploadBytes: 1024,
	requiredHeaders: {
		'Content-Type': 'text/csv',
		'If-None-Match': '*',
		'x-amz-meta-sha256': DIGEST,
	},
});
const finalised = () => ({
	schemaVersion: 1,
	sourceId: 'source_1',
	revisionId: 'rev_1',
	generation: 1,
	status: 'ACCEPTED',
});
const cryptoProvider = {
	randomUUID: () => '12345678-1234-4234-8234-123456789012',
	subtle: { digest: async () => new Uint8Array(32).fill(0xaa).buffer },
};
function harness({
	send = vi.fn(async () => ({ ok: true, status: 200 })),
	intentValue = intent(),
	clock = () => NOW,
	crypto = cryptoProvider,
} = {}) {
	const request = vi.fn(async ({ path }) =>
		path.endsWith('/upload-intents') ? intentValue : finalised()
	);
	const stages = [];
	const upload = createKnowledgeUploader({
		request,
		send,
		cryptoProvider: crypto,
		now: clock,
		timeoutMs: 10000,
	});
	return {
		request,
		send,
		stages,
		run: (overrides = {}, options = {}) =>
			upload(
				{ ...payload(), ...overrides },
				{
					onProgress: (stage) => stages.push(stage),
					...options,
				}
			),
	};
}

describe('ARCH-035-WOOCOMMERCE-015 browser direct R2 upload', () => {
	it('generates a version-4 UUID without randomUUID when secure random bytes exist', async () => {
		const crypto = {
			getRandomValues: (bytes) => bytes.fill(255),
			subtle: cryptoProvider.subtle,
		};
		const h = harness({ crypto });
		await h.run();
		expect(h.request.mock.calls[0][0].data.idempotencyKey).toBe(
			'ffffffff-ffff-4fff-bfff-ffffffffffff'
		);
	});
	it('hashes bytes, preserves required signed headers, omits credentials and finalises only after PUT', async () => {
		const h = harness();
		await expect(h.run()).resolves.toEqual(finalised());
		expect(h.stages).toEqual(['HASHING', 'UPLOADING', 'FINALIZING']);
		expect(h.request).toHaveBeenCalledTimes(2);
		const metadata = h.request.mock.calls[0][0];
		expect(metadata.data).toEqual({
			idempotencyKey: '12345678-1234-4234-8234-123456789012',
			purposeKey: 'FAQ',
			dataFormatKey: 'CSV',
			originalFileName: 'faq.csv',
			contentType: 'text/csv',
			sizeBytes: 4,
			sha256: DIGEST,
		});
		const [url, put] = h.send.mock.calls[0];
		expect(url).toBe(SIGNED);
		expect(put).toMatchObject({
			method: 'PUT',
			mode: 'cors',
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			headers: intent().requiredHeaders,
		});
		expect(put.body.name).toBe('faq.csv');
		expect(put.body.size).toBe(4);
		expect(Object.keys(put.headers)).toEqual([
			'Content-Type',
			'If-None-Match',
			'x-amz-meta-sha256',
		]);
		expect(put.headers).not.toHaveProperty('X-WP-Nonce');
		expect(put.headers).not.toHaveProperty('Authorization');
		expect(h.request.mock.calls[1][0].data).toEqual({
			assetId: 'asset_1',
			purposeKey: 'FAQ',
			name: 'FAQ',
			languageTag: 'en',
			contentType: 'text/csv',
			sizeBytes: 4,
			sha256: DIGEST,
		});
	});

	it.each([
		[412, false],
		[500, false],
		[302, true],
	])(
		'never finalises failed or redirected PUT (%s)',
		async (status, redirected) => {
			const h = harness({
				send: vi.fn(async () => ({ status, ok: false, redirected })),
			});
			await expect(h.run()).rejects.toMatchObject({
				code: status === 412 ? 'UPLOAD_CONFLICT' : 'UPLOAD_FAILED',
			});
			expect(h.request).toHaveBeenCalledTimes(1);
		}
	);

	it('rejects CORS preflight/network errors and aborts without finalisation', async () => {
		const h = harness({
			send: vi.fn(async () => {
				throw new TypeError('CORS denied');
			}),
		});
		await expect(h.run()).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
		expect(h.request).toHaveBeenCalledTimes(1);
		const controller = new AbortController();
		const cancelled = harness({
			send: vi.fn(async () => {
				controller.abort();
				return { ok: true, status: 200 };
			}),
		});
		await expect(
			cancelled.run({}, { signal: controller.signal })
		).rejects.toMatchObject({ code: 'ABORTED' });
		expect(cancelled.request).toHaveBeenCalledTimes(1);
	});

	it('accepts the new immutable domain/timestamp object key and still finalises only after R2 PUT', async () => {
		const current = {
			...intent(),
			assetId: CURRENT_ASSET,
			uploadUrl: CURRENT_SIGNED,
		};
		const h = harness({ intentValue: current });
		await expect(h.run()).resolves.toEqual(finalised());
		expect(h.send).toHaveBeenCalledTimes(1);
		expect(h.send.mock.calls[0][0]).toBe(CURRENT_SIGNED);
		expect(h.request.mock.calls[1][0].data.assetId).toBe(CURRENT_ASSET);
	});

	it('uses the URL issued by the authenticated Moda API without parsing R2 object keys or signatures', async () => {
		const alternateUrl = `${URL_BASE.replace('/asset_1/source.csv', '/opaque-provider-key')}?token=example`;
		const alternate = { ...intent(), uploadUrl: alternateUrl };
		const h = harness({ intentValue: alternate });
		await expect(h.run()).resolves.toEqual(finalised());
		expect(h.send.mock.calls[0][0]).toBe(alternate.uploadUrl);
		expect(h.send.mock.calls[0][1].headers).toEqual(
			alternate.requiredHeaders
		);
	});

	it('requires the basic fields needed to execute the API-issued capability', async () => {
		for (const broken of [
			{ ...intent(), uploadUrl: '' },
			{ ...intent(), assetId: '' },
			{ ...intent(), requiredHeaders: null },
			{ ...intent(), expiresAt: 'not-a-date' },
		]) {
			const h = harness({ intentValue: broken });
			await expect(h.run()).rejects.toMatchObject({
				code: 'UPLOAD_CAPABILITY_INVALID',
			});
			expect(h.send).not.toHaveBeenCalled();
		}
	});

	it('fails closed on invalid file size and MIME before requesting a signed capability', async () => {
		const h = harness();
		await expect(
			h.run({ file: { ...file(), size: 2048 } })
		).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		await expect(
			h.run({ file: { ...file(), type: 'application/octet-stream' } })
		).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		expect(h.request).not.toHaveBeenCalled();
	});

	it('does not upload when the server-issued intent has expired', async () => {
		const h = harness({ clock: () => NOW + 60000 });
		await expect(h.run()).rejects.toMatchObject({ code: 'UPLOAD_EXPIRED' });
		expect(h.send).not.toHaveBeenCalled();
	});
});
