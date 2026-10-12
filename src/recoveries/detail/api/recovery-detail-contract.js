const ID = /^[A-Za-z0-9_-]{1,191}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL = /^-?\d{1,40}(?:\.\d{1,30})?$/;
const STATUS = [
	'DETECTED',
	'MESSAGE_SENT',
	'ENGAGED',
	'COMPLETED',
	'EXPIRED',
	'CANCELLED',
];
const DIRECTION = ['INBOUND', 'OUTBOUND'];
const SENDER = ['CUSTOMER', 'AGENT', 'AUTOMATION', 'HUMAN'];
const DELIVERY = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'];
const CONTENT = ['TEXT', 'AUDIO', 'UNSUPPORTED'];
const TRANSCRIPTION = [
	'NOT_REQUIRED',
	'PENDING',
	'COMPLETED',
	'REJECTED',
	'FAILED',
];

export function validRecoveryId(value) {
	return typeof value === 'string' && ID.test(value);
}

export function validCursor(value) {
	return typeof value === 'string' && CURSOR.test(value);
}

function object(value, fields) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).sort().join(',') === [...fields].sort().join(',')
	);
}

function time(value) {
	return (
		typeof value === 'string' &&
		ISO.test(value) &&
		Number.isFinite(Date.parse(value)) &&
		new Date(value).toISOString() === value
	);
}

function nullableTime(value) {
	return value === null || time(value);
}

function text(value, max) {
	return value === null || (typeof value === 'string' && value.length <= max);
}

function valueDto(value) {
	return (
		object(value, ['amount', 'currency', 'incomplete']) &&
		(value.amount === null ||
			(typeof value.amount === 'string' && DECIMAL.test(value.amount))) &&
		(value.currency === null ||
			(typeof value.currency === 'string' &&
				/^[A-Z]{3}$/.test(value.currency))) &&
		value.incomplete === (value.amount === null || value.currency === null)
	);
}

function summary(value) {
	if (
		!object(value, [
			'schemaVersion',
			'timeZone',
			'id',
			'status',
			'value',
			'customer',
			'hasConversation',
			'milestones',
		]) ||
		value.schemaVersion !== 1 ||
		!validRecoveryId(value.id) ||
		!STATUS.includes(value.status) ||
		!valueDto(value.value) ||
		typeof value.timeZone !== 'string' ||
		!value.timeZone ||
		value.timeZone.length > 128 ||
		typeof value.hasConversation !== 'boolean'
	) {
		return false;
	}
	if (
		value.customer !== null &&
		(!object(value.customer, ['firstName', 'lastName', 'email']) ||
			!text(value.customer.firstName, 80) ||
			!text(value.customer.lastName, 80) ||
			!text(value.customer.email, 320))
	) {
		return false;
	}
	const m = value.milestones;
	return (
		object(m, [
			'detectedAt',
			'messageSentAt',
			'engagedAt',
			'completedAt',
			'expiredAt',
		]) &&
		time(m.detectedAt) &&
		nullableTime(m.messageSentAt) &&
		nullableTime(m.engagedAt) &&
		nullableTime(m.completedAt) &&
		nullableTime(m.expiredAt)
	);
}

function message(value) {
	if (
		!object(value, [
			'id',
			'createdAt',
			'direction',
			'sender',
			'content',
			'delivery',
		]) ||
		!validRecoveryId(value.id) ||
		!time(value.createdAt) ||
		(value.direction !== null && !DIRECTION.includes(value.direction)) ||
		(value.sender !== null && !SENDER.includes(value.sender)) ||
		!object(value.content, ['type', 'text', 'transcriptionStatus']) ||
		!CONTENT.includes(value.content.type) ||
		!text(value.content.text, 32000) ||
		(value.content.transcriptionStatus !== null &&
			!TRANSCRIPTION.includes(value.content.transcriptionStatus))
	) {
		return false;
	}
	const d = value.delivery;
	return (
		d === null ||
		(object(d, ['status', 'sentAt', 'deliveredAt', 'readAt']) &&
			(d.status === null || DELIVERY.includes(d.status)) &&
			nullableTime(d.sentAt) &&
			nullableTime(d.deliveredAt) &&
			nullableTime(d.readAt))
	);
}

function related(value) {
	return (
		object(value, ['id', 'status', 'value', 'detectedAt']) &&
		validRecoveryId(value.id) &&
		STATUS.includes(value.status) &&
		valueDto(value.value) &&
		time(value.detectedAt)
	);
}

export function parseRecoveryDetailResponse(section, response) {
	const valid =
		section === 'summary'
			? summary(response)
			: object(response, [
					'schemaVersion',
					'items',
					'previousCursor',
					'nextCursor',
				]) &&
				response.schemaVersion === 1 &&
				(response.previousCursor === null ||
					validCursor(response.previousCursor)) &&
				(response.nextCursor === null ||
					validCursor(response.nextCursor)) &&
				Array.isArray(response.items) &&
				response.items.length <= (section === 'messages' ? 50 : 5) &&
				response.items.every(
					section === 'messages' ? message : related
				);
	if (!valid || !['summary', 'messages', 'related'].includes(section)) {
		throw new Error('remote_response_invalid');
	}
	return response;
}
