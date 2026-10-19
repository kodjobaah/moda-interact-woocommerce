import { describe, it, expect, vi } from 'vitest';
import { createKnowledgeUploader, validateSignedUpload } from '../../src/recovery-settings/merchant-knowledge/knowledge-upload-transport';

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const DIGEST = 'a'.repeat(64);
const URL_BASE = 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/knowledge-assets/merchant-knowledge/test-1/woocommerce/shop_1/asset_1/source.csv';
const SIGNED = `${URL_BASE}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=example&X-Amz-Date=20261019T120000Z&X-Amz-Expires=60&X-Amz-SignedHeaders=content-type%3Bhost%3Bif-none-match%3Bx-amz-meta-sha256&X-Amz-Signature=${'b'.repeat(64)}`;
const file = () => ({
	name: 'faq.csv', size: 4, type: 'text/csv',
	arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
});
const payload = () => ({
	name: 'FAQ', purpose: 'FAQ', languageTag: 'en', dataFormatKey: 'CSV',
	file: file(), maxUploadBytes: 1024,
	catalogue: [{ purpose: { key: 'FAQ' }, dataFormat: {
		key: 'CSV', inputKind: 'UPLOAD', acceptedContentTypes: ['text/csv'],
	} }],
});
const intent = () => ({
	schemaVersion: 1, assetId: 'asset_1', uploadUrl: SIGNED,
	expiresAt: new Date(NOW + 60000).toISOString(), maxUploadBytes: 1024,
	requiredHeaders: {
		'Content-Type': 'text/csv', 'If-None-Match': '*',
		'x-amz-meta-sha256': DIGEST,
	},
});
const finalised = () => ({
	schemaVersion: 1, sourceId: 'source_1', revisionId: 'rev_1',
	generation: 1, status: 'ACCEPTED',
});
const cryptoProvider = {
	randomUUID: () => '12345678-1234-4234-8234-123456789012',
	subtle: { digest: async () => new Uint8Array(32).fill(0xaa).buffer },
};
function harness({ send = vi.fn(async () => ({ ok: true, status: 200 })),
	intentValue = intent(), clock = () => NOW } = {}) {
	const request = vi.fn(async ({ path }) =>
		path.endsWith('/upload-intents') ? intentValue : finalised()
	);
	const stages = [];
	const upload = createKnowledgeUploader({
		request, send, cryptoProvider, now: clock, timeoutMs: 10000,
	});
	return { request, send, stages,
		run: (overrides = {}, options = {}) => upload({ ...payload(), ...overrides }, {
			onProgress: (stage) => stages.push(stage), ...options,
		}),
	};
}

describe('ARCH-035-WOOCOMMERCE-015 browser direct R2 upload', () => {
	it('hashes bytes, preserves required signed headers, omits credentials and finalises only after PUT', async () => {
		const h = harness();
		await expect(h.run()).resolves.toEqual(finalised());
		expect(h.stages).toEqual(['HASHING', 'UPLOADING', 'FINALIZING']);
		expect(h.request).toHaveBeenCalledTimes(2);
		const metadata = h.request.mock.calls[0][0];
		expect(metadata.data).toEqual({
			idempotencyKey: '12345678-1234-4234-8234-123456789012',
			purposeKey: 'FAQ', dataFormatKey: 'CSV', originalFileName: 'faq.csv',
			contentType: 'text/csv', sizeBytes: 4, sha256: DIGEST,
		});
		const [url, put] = h.send.mock.calls[0];
		expect(url).toBe(SIGNED);
		expect(put).toMatchObject({
			method: 'PUT', mode: 'cors',
			credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
			headers: intent().requiredHeaders,
		});
		expect(put.body.name).toBe('faq.csv');
		expect(put.body.size).toBe(4);
		expect(Object.keys(put.headers)).toEqual([
			'Content-Type', 'If-None-Match', 'x-amz-meta-sha256',
		]);
		expect(put.headers).not.toHaveProperty('X-WP-Nonce');
		expect(put.headers).not.toHaveProperty('Authorization');
		expect(h.request.mock.calls[1][0].data).toEqual({
			assetId: 'asset_1', purposeKey: 'FAQ', name: 'FAQ', languageTag: 'en',
			contentType: 'text/csv', sizeBytes: 4, sha256: DIGEST,
		});
	});

	it.each([
		[412, false], [500, false], [302, true],
	])('never finalises failed or redirected PUT (%s)', async (status, redirected) => {
		const h = harness({ send: vi.fn(async () => ({ status, ok: false, redirected })) });
		await expect(h.run()).rejects.toMatchObject({ code: status === 412 ? 'UPLOAD_CONFLICT' : 'UPLOAD_FAILED' });
		expect(h.request).toHaveBeenCalledTimes(1);
	});

	it('rejects CORS preflight/network errors and aborts without finalisation', async () => {
		const h = harness({ send: vi.fn(async () => { throw new TypeError('CORS denied'); }) });
		await expect(h.run()).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
		expect(h.request).toHaveBeenCalledTimes(1);
		const controller = new AbortController();
		const cancelled = harness({ send: vi.fn(async () => {
			controller.abort();
			return { ok: true, status: 200 };
		}) });
		await expect(cancelled.run({}, { signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' });
		expect(cancelled.request).toHaveBeenCalledTimes(1);
	});

	it('rejects unapproved host, missing headers, expired and malformed capability before PUT', async () => {
		const bad = [
			{ ...intent(), uploadUrl: SIGNED.replace('.r2.cloudflarestorage.com', '.example.org') },
			{ ...intent(), uploadUrl: SIGNED.replace('source.csv', 'source.xlsx') },
			{ ...intent(), requiredHeaders: { ...intent().requiredHeaders, Authorization: 'secret' } },
			{ ...intent(), requiredHeaders: { ...intent().requiredHeaders, 'x-amz-meta-sha256': 'not-correct' } },
			{ ...intent(), expiresAt: new Date(NOW - 1).toISOString() },
		];
		for (const intentValue of bad) {
			const h = harness({ intentValue });
			await expect(h.run()).rejects.toMatchObject({ code: 'UPLOAD_CAPABILITY_INVALID' });
			expect(h.send).not.toHaveBeenCalled();
			expect(h.request).toHaveBeenCalledTimes(1);
		}
	});

	it('fails closed on invalid file size and MIME before requesting a signed capability', async () => {
		const h = harness();
		await expect(h.run({ file: { ...file(), size: 2048 } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		await expect(h.run({ file: { ...file(), type: 'application/octet-stream' } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
		expect(h.request).not.toHaveBeenCalled();
	});

	it('refuses upload after signed expiry even if metadata was previously valid', () => {
		expect(() => validateSignedUpload(intent(), {
			contentType: 'text/csv', sizeBytes: 4, sha256: DIGEST, extension: '.csv',
		}, NOW + 60000)).toThrow('UPLOAD_CAPABILITY_INVALID');
	});
});
