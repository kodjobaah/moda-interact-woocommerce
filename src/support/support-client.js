import apiFetch from '@wordpress/api-fetch';
import {
	SUPPORT_PATH,
	parseSupportPage,
	parseComposeReceipt,
	parseReadReceipt,
	validMessageId,
	validSupportPageRequest,
	validSupportSend,
} from './support-contract';

/** Public, bounded failure reasons; never surface provider error text or credentials. */
export function supportTransportError(error) {
	let status = error?.statusCode;
	if (typeof error?.status === 'number') {
		status = error.status;
	}
	if (typeof error?.data?.status === 'number') {
		status = error.data.status;
	}
	const code =
		error?.code ??
		(typeof error?.status === 'string' ? error.status : null) ??
		(typeof error?.data?.status === 'string' ? error.data.status : null) ??
		error?.message;
	let reason = 'remote_unavailable';
	if (code === 'SUPPORT_UNAVAILABLE') {
		reason = 'send_unavailable';
	} else if (
		status === 401 ||
		[
			'RECONNECT_REQUIRED',
			'SITE_URL_CHANGED',
			'LOCAL_STATE_INVALID',
		].includes(code)
	) {
		reason = 'connection_unavailable';
	} else if (status === 403 || code === 'FORBIDDEN') {
		reason = 'forbidden';
	} else if (code === 'ACTION_CONFLICT') {
		reason = 'idempotency_conflict';
	} else if (code === 'INVALID_REQUEST' || code === 'invalid_request') {
		reason = 'invalid_request';
	} else if (code === 'remote_response_invalid') {
		reason = 'remote_response_invalid';
	}
	const safeError = new Error(reason);
	safeError.code = reason;
	return safeError;
}

/** WordPress apiFetch supplies the REST nonce; no hosted credentials enter JavaScript. */
export function createSupportClient(request = apiFetch) {
	return Object.freeze({
		capabilities: Object.freeze({ read: true, send: true, markRead: true }),
		async list({ page = 1, pageSize = 25 }, signal) {
			if (!validSupportPageRequest(page, pageSize)) {
				throw new Error('invalid_request');
			}
			try {
				const params = new URLSearchParams({
					page: String(page),
					pageSize: String(pageSize),
				});
				return parseSupportPage(
					await request({
						path: `${SUPPORT_PATH}?${params}`,
						method: 'GET',
						signal,
					}),
					page,
					pageSize
				);
			} catch (error) {
				throw supportTransportError(error);
			}
		},
		async send(body, actionId, signal) {
			if (!validSupportSend(body, actionId)) {
				throw new Error('invalid_request');
			}
			try {
				return parseComposeReceipt(
					await request({
						path: SUPPORT_PATH,
						method: 'POST',
						data: { body, actionId },
						signal,
					})
				);
			} catch (error) {
				throw supportTransportError(error);
			}
		},
		async markRead(messageId, signal) {
			if (!validMessageId(messageId)) {
				throw new Error('invalid_request');
			}
			try {
				return parseReadReceipt(
					await request({
						path: `${SUPPORT_PATH}/${encodeURIComponent(messageId)}/read`,
						method: 'POST',
						signal,
					}),
					messageId
				);
			} catch (error) {
				throw supportTransportError(error);
			}
		},
	});
}
