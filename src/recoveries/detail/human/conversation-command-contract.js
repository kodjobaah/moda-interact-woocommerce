import { validRecoveryId } from '../api/recovery-detail-contract';

const STATES = [
	'ACCEPTED',
	'CLAIMED',
	'DISPATCH_ADMITTED',
	'SENT',
	'FAILED',
	'CANCELLED',
	'UNKNOWN',
];
const KINDS = ['HUMAN_TEXT', 'RECOVERY_FOLLOW_UP_TEMPLATE'];
const MODERATION = [
	'moderation_pending',
	'moderation_allowed',
	'moderation_blocked',
	'moderation_review_required',
	'moderation_retryable_error',
];
const REASONS = [
	null,
	'moderation_blocked',
	'moderation_review_required',
	'moderation_empty_input',
	'moderation_unavailable',
];

function keys(value, expected) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).sort().join(',') === [...expected].sort().join(',')
	);
}
function revision(value) {
	return Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
}

export function parseCommandResponse(
	operation,
	response,
	conversationId,
	commandId = null
) {
	if (
		response?.schemaVersion !== 1 ||
		response.conversationId !== conversationId ||
		!validRecoveryId(conversationId)
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	if (operation === 'control') {
		if (
			!keys(response, [
				'schemaVersion',
				'conversationId',
				'controlMode',
				'controlRevision',
				'controlChangedAt',
			]) ||
			!['AI', 'HUMAN'].includes(response.controlMode) ||
			!revision(response.controlRevision) ||
			(response.controlChangedAt !== null &&
				!Number.isFinite(Date.parse(response.controlChangedAt)))
		) {
			throw new Error('REMOTE_RESPONSE_INVALID');
		}
	} else {
		const common = [
			'schemaVersion',
			'commandId',
			'conversationId',
			'kind',
			'state',
		];
		const valid =
			operation === 'messages'
				? keys(response, [...common, 'controlRevision']) &&
					revision(response.controlRevision)
				: operation === 'status' &&
					keys(response, [
						...common,
						'createdAt',
						'updatedAt',
						'messageId',
						'failureCode',
						'moderationStatus',
						'moderationReasonCode',
					]) &&
					response.commandId === commandId &&
					!Number.isNaN(Date.parse(response.createdAt)) &&
					!Number.isNaN(Date.parse(response.updatedAt)) &&
					(response.messageId === null ||
						validRecoveryId(response.messageId)) &&
					(response.failureCode === null ||
						(typeof response.failureCode === 'string' &&
							response.failureCode.length <= 128)) &&
					MODERATION.includes(response.moderationStatus) &&
					REASONS.includes(response.moderationReasonCode);
		if (
			!valid ||
			!validRecoveryId(response.commandId) ||
			!KINDS.includes(response.kind) ||
			!STATES.includes(response.state)
		) {
			throw new Error('REMOTE_RESPONSE_INVALID');
		}
	}
	return response;
}

export function parseFollowUpTemplates(response) {
	if (
		!keys(response, ['schemaVersion', 'templates']) ||
		response.schemaVersion !== 1 ||
		!Array.isArray(response.templates) ||
		response.templates.length > 30 ||
		!response.templates.every(
			(template) =>
				keys(template, ['name', 'language']) &&
				typeof template.name === 'string' &&
				/^[a-z][a-z0-9_]{0,254}$/.test(template.name) &&
				typeof template.language === 'string' &&
				/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language)
		)
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return response.templates;
}

export function commandInput(kind, revisionNumber, key, input) {
	if (
		!revision(revisionNumber) ||
		!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key)
	) {
		throw new Error('INVALID_REQUEST');
	}
	if (kind === 'HUMAN_TEXT') {
		if (
			typeof input !== 'string' ||
			input !== input.trim() ||
			!input ||
			[...input].length > 4000 ||
			/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input)
		) {
			throw new Error('INVALID_REQUEST');
		}
		return {
			kind,
			expectedControlRevision: revisionNumber,
			idempotencyKey: key,
			textBody: input,
		};
	}
	if (
		kind !== 'RECOVERY_FOLLOW_UP_TEMPLATE' ||
		!input ||
		!/^[a-z][a-z0-9_]{0,254}$/.test(input.templateName) ||
		!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(input.templateLanguage) ||
		!Array.isArray(input.templateParameters) ||
		input.templateParameters.length !== 0
	) {
		throw new Error('INVALID_REQUEST');
	}
	return {
		kind,
		expectedControlRevision: revisionNumber,
		idempotencyKey: key,
		templateName: input.templateName,
		templateLanguage: input.templateLanguage,
		templateParameters: input.templateParameters,
	};
}

export function humanActionAvailability(
	summary,
	now = Date.now(),
	templates = []
) {
	const conversation = summary?.conversation;
	const blocked =
		!summary?.humanMessagingAllowed ||
		summary?.humanMessagingStatus !== 'ACTIVE';
	const expiresAt =
		typeof conversation?.windowExpiresAt === 'string'
			? Date.parse(conversation.windowExpiresAt)
			: Number.NaN;
	const hasWindowExpiry = Number.isFinite(expiresAt);
	const open = hasWindowExpiry && now < expiresAt;
	const windowClosed = hasWindowExpiry && now >= expiresAt;
	return {
		mode: conversation?.controlMode ?? null,
		canTakeOver:
			!!conversation && conversation.controlMode === 'AI' && !blocked,
		canResumeAI: !!conversation && conversation.controlMode === 'HUMAN',
		canText:
			!!conversation &&
			conversation.controlMode === 'HUMAN' &&
			!blocked &&
			open,
		windowOpen: open,
		windowClosed,
		suspended: blocked,
		followUpUsed: conversation?.followUp?.sequence2Used === true,
		canOfferTemplatePicker:
			!!conversation &&
			conversation.controlMode === 'HUMAN' &&
			!blocked &&
			windowClosed &&
			conversation?.followUp?.sequence2Used !== true,
		canTemplate:
			!!conversation &&
			conversation.controlMode === 'HUMAN' &&
			!blocked &&
			windowClosed &&
			conversation?.followUp?.sequence2Used !== true &&
			Array.isArray(templates) &&
			templates.length > 0,
	};
}
