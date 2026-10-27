import apiFetch from '@wordpress/api-fetch';
import { validRecoveryId } from '../api/recovery-detail-contract';
import {
	commandInput,
	parseCommandResponse,
	parseFollowUpTemplates,
} from './conversation-command-contract';

const BASE = '/moda-interact/v1/merchant/recoveries';
const CODES = new Set([
	'FORBIDDEN',
	'INVALID_REQUEST',
	'RECONNECT_REQUIRED',
	'LOCAL_STATE_INVALID',
	'SITE_URL_CHANGED',
	'CONVERSATION_UNAVAILABLE',
	'HUMAN_MESSAGING_SUSPENDED',
	'IDEMPOTENCY_CONFLICT',
	'STALE_CONTROL_REVISION',
	'CONVERSATION_CONTROL_CONFLICT',
	'NOT_HUMAN_CONTROLLED',
	'FOLLOW_UP_UNAVAILABLE',
	'TEMPLATE_NOT_ALLOWED',
	'SERVICE_WINDOW_CLOSED',
	'RECIPIENT_UNAVAILABLE',
	'SEND_ENTITLEMENT_UNAVAILABLE',
	'HUMAN_CONTENT_INVALID',
	'REMOTE_RESPONSE_INVALID',
	'REMOTE_UNAVAILABLE',
]);
function safeError(error) {
	const code = [error?.data?.status, error?.code, error?.message].find(
		(value) => CODES.has(value)
	);
	return new Error(code || 'REMOTE_UNAVAILABLE');
}

/** All browser calls stop at nonce-authenticated WP REST, not the hosted API. */
export function createConversationCommandClient(request = apiFetch) {
	async function call(
		recoveryId,
		operation,
		data = null,
		commandId = null,
		signal
	) {
		if (
			!validRecoveryId(recoveryId) ||
			(commandId && !validRecoveryId(commandId))
		) {
			throw new Error('INVALID_REQUEST');
		}
		const suffix =
			operation === 'status'
				? `/send-commands/${encodeURIComponent(commandId)}`
				: `/${operation}`;
		const path = `${BASE}/${encodeURIComponent(recoveryId)}/conversation${suffix}`;
		try {
			const response = await request({
				path,
				method: operation === 'status' ? 'GET' : 'POST',
				...(data ? { data } : {}),
				signal,
			});
			// The conversationId is authoritative from the selected summary. It
			// is validated against that summary by the controller below.
			return response;
		} catch (error) {
			throw safeError(error);
		}
	}
	return {
		async followUpTemplates(recoveryId, signal) {
			if (!validRecoveryId(recoveryId)) {
				throw new Error('INVALID_REQUEST');
			}
			try {
				const response = await request({
					path: `${BASE}/${encodeURIComponent(recoveryId)}/conversation/follow-up-templates`,
					method: 'GET',
					signal,
				});
				return parseFollowUpTemplates(response);
			} catch (error) {
				throw safeError(error);
			}
		},
		async control(recoveryId, conversation, mode, revision, signal) {
			if (
				!conversation?.id ||
				!['AI', 'HUMAN'].includes(mode) ||
				!Number.isSafeInteger(revision)
			) {
				throw new Error('INVALID_REQUEST');
			}
			const result = await call(
				recoveryId,
				'control',
				{ targetMode: mode, expectedControlRevision: revision },
				null,
				signal
			);
			return parseCommandResponse('control', result, conversation.id);
		},
		async send(recoveryId, conversation, kind, key, content, signal) {
			if (!conversation?.id) {
				throw new Error('INVALID_REQUEST');
			}
			const result = await call(
				recoveryId,
				'messages',
				commandInput(kind, conversation.controlRevision, key, content),
				null,
				signal
			);
			return parseCommandResponse('messages', result, conversation.id);
		},
		async status(recoveryId, conversationId, commandId, signal) {
			const result = await call(
				recoveryId,
				'status',
				null,
				commandId,
				signal
			);
			return parseCommandResponse(
				'status',
				result,
				conversationId,
				commandId
			);
		},
	};
}
