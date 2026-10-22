import { validSupportBody } from './support-validation';

export const SUPPORT_PATH = '/moda-interact/v1/merchant/support/messages';
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,191}$/;
const ACTION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PAGE_SIZES = [10, 25, 50];
const MESSAGE_FIELDS = [
	'id',
	'kind',
	'state',
	'originalBody',
	'displayBody',
	'isTranslated',
	'sourceLanguageTag',
	'displayLanguageTag',
	'systemCode',
	'systemVersion',
	'createdAt',
	'readAt',
];
const record = (value) =>
	value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) =>
	record(value) &&
	Object.keys(value).length === keys.length &&
	keys.every((key) => Object.hasOwn(value, key));
const nullable = (value, check) => value === null || check(value);
const bounded = (value, length) =>
	typeof value === 'string' && value.length <= length;
const date = (value) =>
	typeof value === 'string' &&
	/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(
		value
	) &&
	!Number.isNaN(Date.parse(value));
const validMessage = (message) =>
	exact(message, MESSAGE_FIELDS) &&
	MESSAGE_ID.test(message.id) &&
	['MERCHANT', 'ADMINISTRATIVE', 'SYSTEM'].includes(message.kind) &&
	['PROCESSING', 'AVAILABLE', 'FAILED'].includes(message.state) &&
	bounded(message.originalBody, 32768) &&
	nullable(message.displayBody, (value) => bounded(value, 32768)) &&
	typeof message.isTranslated === 'boolean' &&
	bounded(message.sourceLanguageTag, 64) &&
	nullable(message.displayLanguageTag, (value) => bounded(value, 64)) &&
	nullable(message.systemCode, (value) => bounded(value, 128)) &&
	nullable(message.systemVersion, (value) => bounded(value, 64)) &&
	date(message.createdAt) &&
	nullable(message.readAt, date);

export function parseSupportPage(value, requestedPage, requestedSize) {
	if (
		!exact(value, [
			'schemaVersion',
			'page',
			'pageSize',
			'total',
			'totalPages',
			'unread',
			'items',
		]) ||
		value.schemaVersion !== 1 ||
		value.page !== requestedPage ||
		value.pageSize !== requestedSize ||
		!Number.isSafeInteger(value.total) ||
		value.total < 0 ||
		!Number.isSafeInteger(value.unread) ||
		value.unread < 0 ||
		!Number.isSafeInteger(value.totalPages) ||
		value.totalPages < 1 ||
		!Array.isArray(value.items) ||
		value.items.length > requestedSize ||
		!value.items.every(validMessage)
	) {
		throw new Error('remote_response_invalid');
	}
	return value;
}

export function parseComposeReceipt(value) {
	if (
		!exact(value, ['schemaVersion', 'messageId', 'translationId']) ||
		value.schemaVersion !== 1 ||
		!MESSAGE_ID.test(value.messageId) ||
		!nullable(value.translationId, (id) => MESSAGE_ID.test(id))
	) {
		throw new Error('remote_response_invalid');
	}
	return value;
}

export function parseReadReceipt(value, messageId) {
	if (
		!exact(value, ['schemaVersion', 'messageId', 'readAt']) ||
		value.schemaVersion !== 1 ||
		value.messageId !== messageId ||
		!date(value.readAt)
	) {
		throw new Error('remote_response_invalid');
	}
	return value;
}

export const validMessageId = (id) =>
	typeof id === 'string' && MESSAGE_ID.test(id);
export const validActionId = (id) =>
	typeof id === 'string' && ACTION_ID.test(id);
export const validSupportPageRequest = (page, pageSize) =>
	Number.isSafeInteger(page) &&
	page >= 1 &&
	page <= 999999 &&
	PAGE_SIZES.includes(pageSize);
export const validSupportSend = (body, actionId) =>
	typeof body === 'string' &&
	validSupportBody(body) &&
	validActionId(actionId) &&
	new TextEncoder().encode(JSON.stringify({ body, actionId })).length <=
		32768;
