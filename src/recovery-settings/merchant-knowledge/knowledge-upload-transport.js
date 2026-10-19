import { validKnowledgeFile } from './knowledge-client';

const R2_HOST = /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i;
const MIME = {
	CSV: ['text/csv', 'application/csv'],
	XLSX: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;

const failure = (code) => Object.assign(new Error(code), { code });

function uploadMetadata(payload, limit, catalogue) {
	const { file, dataFormatKey, purpose } = payload;
	if (
		!validKnowledgeFile(file, limit, dataFormatKey) ||
		!file || typeof file.arrayBuffer !== 'function' ||
		!MIME[dataFormatKey] ||
		!file.name || file.name.length > 255 ||
		/[\\/\x00-\x1f\x7f]/.test(file.name) ||
		!catalogue.some(
			(entry) => entry.purpose.key === purpose &&
				entry.dataFormat.key === dataFormatKey &&
				entry.dataFormat.inputKind === 'UPLOAD'
		) ||
		!payload.name?.trim() || payload.name.length > 160 ||
		!payload.languageTag
	) {
		throw failure('INVALID_REQUEST');
	}
	const offered = catalogue.find(
		(entry) => entry.purpose.key === purpose && entry.dataFormat.key === dataFormatKey
	).dataFormat.acceptedContentTypes;
	const accepted = MIME[dataFormatKey].filter((type) => offered.includes(type));
	const contentType = file.type || accepted[0];
	if (!accepted.includes(contentType)) {
		throw failure('INVALID_REQUEST');
	}
	return { contentType, sizeBytes: file.size };
}

export function validateSignedUpload(intent, metadata, now = Date.now()) {
	if (
		!intent || intent.schemaVersion !== 1 || !ID.test(intent.assetId) ||
		!Number.isSafeInteger(intent.maxUploadBytes) ||
		intent.maxUploadBytes < metadata.sizeBytes ||
		intent.maxUploadBytes > 25 * 1024 * 1024 ||
		!intent.requiredHeaders ||
		Object.keys(intent.requiredHeaders).sort().join(',') !==
			['Content-Type', 'If-None-Match', 'x-amz-meta-sha256'].sort().join(',') ||
		intent.requiredHeaders['Content-Type'] !== metadata.contentType ||
		intent.requiredHeaders['If-None-Match'] !== '*' ||
		intent.requiredHeaders['x-amz-meta-sha256'] !== metadata.sha256 ||
		typeof intent.uploadUrl !== 'string' || intent.uploadUrl.length > 4096 ||
		!Number.isFinite(Date.parse(intent.expiresAt)) ||
		Date.parse(intent.expiresAt) <= now + 1000 ||
		Date.parse(intent.expiresAt) > now + 601000
	) {
		throw failure('UPLOAD_CAPABILITY_INVALID');
	}
	let url;
	try {
		url = new URL(intent.uploadUrl);
	} catch {
		throw failure('UPLOAD_CAPABILITY_INVALID');
	}
	const signedDate = url.searchParams.get('X-Amz-Date') ?? '';
	const signedExpiry = Number(url.searchParams.get('X-Amz-Expires'));
	const signatureTime = /^\d{8}T\d{6}Z$/.test(signedDate)
		? Date.parse(`${signedDate.slice(0, 4)}-${signedDate.slice(4, 6)}-${signedDate.slice(6, 8)}T${signedDate.slice(9, 11)}:${signedDate.slice(11, 13)}:${signedDate.slice(13, 15)}Z`)
		: NaN;
	const queryFields = new Set([
		'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date',
		'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature',
		'X-Amz-Security-Token', 'X-Amz-Content-Sha256',
		'x-amz-content-sha256', 'x-id',
	]);
	if (
		url.protocol !== 'https:' || !R2_HOST.test(url.hostname) ||
		url.port || url.username || url.password || url.hash ||
		!/^\/[A-Za-z0-9._-]{3,63}\/merchant-knowledge\/[a-z0-9][a-z0-9-]{0,31}\/woocommerce\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/source\.(csv|xlsx)$/.test(url.pathname) ||
		!url.pathname.includes(`/${intent.assetId}/`) ||
		url.pathname.slice(-metadata.extension.length) !== metadata.extension ||
		!/^[a-f0-9]{64}$/i.test(url.searchParams.get('X-Amz-Signature') ?? '') ||
		url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
		url.searchParams.get('X-Amz-SignedHeaders') !== 'content-type;host;if-none-match;x-amz-meta-sha256' ||
		!/^\d{8}T\d{6}Z$/.test(url.searchParams.get('X-Amz-Date') ?? '') ||
		!/^([1-9][0-9]{0,2})$/.test(url.searchParams.get('X-Amz-Expires') ?? '') ||
		signedExpiry > 600 ||
		!Number.isFinite(signatureTime) ||
		signatureTime > now + 60000 ||
		signatureTime + signedExpiry * 1000 <= now ||
		signatureTime + signedExpiry * 1000 > Date.parse(intent.expiresAt) + 2000 ||
		!url.searchParams.get('X-Amz-Credential') ||
		[...url.searchParams.keys()].some(
			(name) => !queryFields.has(name) || url.searchParams.getAll(name).length !== 1
		)
	) {
		throw failure('UPLOAD_CAPABILITY_INVALID');
	}
	return intent.uploadUrl; // Preserve original signed bytes and query verbatim.
}

function uuid(cryptoProvider) {
	if (typeof cryptoProvider?.randomUUID === 'function') {
		return cryptoProvider.randomUUID();
	}
	if (typeof cryptoProvider?.getRandomValues !== 'function') {
		throw failure('UPLOAD_UNAVAILABLE');
	}
	const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 15) | 64;
	bytes[8] = (bytes[8] & 63) | 128;
	const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function checksum(file, cryptoProvider, signal) {
	if (signal?.aborted) throw failure('ABORTED');
	if (typeof cryptoProvider?.subtle?.digest !== 'function') {
		throw failure('UPLOAD_UNAVAILABLE');
	}
	const buffer = await file.arrayBuffer();
	if (signal?.aborted) throw failure('ABORTED');
	const digest = await cryptoProvider.subtle.digest('SHA-256', buffer);
	if (signal?.aborted) throw failure('ABORTED');
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// Upload cancellation and timeout are implemented with the browser Fetch API
// (redirect: error). Fetch does not expose trustworthy byte-level upload
// progress on all supported browsers; report truthful phase transitions only.
export function createKnowledgeUploader({
	request,
	send = (...args) => globalThis.fetch(...args),
	cryptoProvider = globalThis.crypto,
	now = () => Date.now(),
	timeoutMs = 120000,
}) {
	return async function upload(payload, { signal, onProgress } = {}) {
		const metadata = uploadMetadata(payload, payload.maxUploadBytes, payload.catalogue);
		if (signal?.aborted) throw failure('ABORTED');
		onProgress?.('HASHING');
		const sha256 = await checksum(payload.file, cryptoProvider, signal);
		if (!SHA.test(sha256)) throw failure('UPLOAD_HASH_INVALID');
		const uploadRequest = {
			idempotencyKey: uuid(cryptoProvider),
			purposeKey: payload.purpose,
			dataFormatKey: payload.dataFormatKey,
			originalFileName: payload.file.name,
			contentType: metadata.contentType,
			sizeBytes: metadata.sizeBytes,
			sha256,
		};
		const intent = await request({
			path: '/moda-interact/v1/merchant/merchant-knowledge/upload-intents',
			method: 'POST',
			data: uploadRequest,
			signal,
		});
		if (signal?.aborted) throw failure('ABORTED');
		const url = validateSignedUpload(intent, {
			...metadata,
			sha256,
			extension: `.${payload.dataFormatKey.toLowerCase()}`,
		}, now());
		if (typeof AbortController === 'undefined') throw failure('UPLOAD_UNAVAILABLE');
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener('abort', abort, { once: true });
		const limit = Math.min(timeoutMs, Date.parse(intent.expiresAt) - now() - 1000);
		if (limit <= 0) {
			signal?.removeEventListener('abort', abort);
			throw failure('UPLOAD_EXPIRED');
		}
		const timer = setTimeout(abort, limit);
		try {
			if (signal?.aborted) throw failure('ABORTED');
			onProgress?.('UPLOADING');
			let result;
			try {
				result = await send(url, {
					method: 'PUT',
					headers: intent.requiredHeaders,
					body: payload.file,
					mode: 'cors',
					credentials: 'omit',
					redirect: 'error',
					referrerPolicy: 'no-referrer',
					signal: controller.signal,
				});
			} catch (error) {
				if (controller.signal.aborted || signal?.aborted) {
					throw failure(signal?.aborted ? 'ABORTED' : 'UPLOAD_TIMEOUT');
				}
				throw failure('UPLOAD_FAILED');
			}
			if (signal?.aborted) throw failure('ABORTED');
			if (!result || result.redirected || !result.ok) {
				throw failure(result?.status === 412 ? 'UPLOAD_CONFLICT' : 'UPLOAD_FAILED');
			}
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		}
		if (signal?.aborted || now() >= Date.parse(intent.expiresAt)) {
			throw failure(signal?.aborted ? 'ABORTED' : 'UPLOAD_EXPIRED');
		}
		onProgress?.('FINALIZING');
		const finalize = {
			assetId: intent.assetId,
			purposeKey: payload.purpose,
			name: payload.name.trim(),
			languageTag: payload.languageTag,
			contentType: metadata.contentType,
			sizeBytes: metadata.sizeBytes,
			sha256,
			...(payload.id ? { sourceId: payload.id } : {}),
		};
		return request({
			path: '/moda-interact/v1/merchant/merchant-knowledge/upload-finalize',
			method: 'POST',
			data: finalize,
			signal,
		});
	};
}
