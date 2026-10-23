import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/**
 * Escape all message content using React text nodes; link only safe HTTP(S) URLs.
 * @param {Object} root0
 * @param {string} root0.text
 */
export function SafeMessageText({ text }) {
	return createElement(
		'p',
		{ className: 'moda-recovery-detail__message-text', dir: 'auto' },
		...(typeof text === 'string'
			? text.split(/(https?:\/\/[^\s<>]+)/giu)
			: []
		).map((part, index) => {
			let valid = false;
			try {
				const url = new URL(part);
				valid =
					['http:', 'https:'].includes(url.protocol) &&
					!url.username &&
					!url.password;
			} catch {
				// Non-URL segments remain escaped text.
			}
			return valid
				? createElement(
						'a',
						{
							key: index,
							href: part,
							target: '_blank',
							rel: 'noopener noreferrer',
						},
						part
					)
				: part;
		})
	);
}

const SENDER = {
	assistant: 'Moda assistant',
	customer: 'Customer',
	automation: 'Automated message',
	team: 'Team member',
};

function senderLabel(sender) {
	// Keep gettext calls literal so WordPress translation extraction sees them.
	switch (SENDER[sender]) {
		case 'Moda assistant':
			return __('Moda assistant', 'moda-interact');
		case 'Customer':
			return __('Customer', 'moda-interact');
		case 'Automated message':
			return __('Automated message', 'moda-interact');
		case 'Team member':
			return __('Team member', 'moda-interact');
		default:
			return __('Unknown sender', 'moda-interact');
	}
}

/**
 * Testable message bubble; input is presentation data, not an API contract.
 * @param {Object} root0
 * @param {Object} root0.message
 */
export function ConversationMessage({ message }) {
	const direction =
		message?.direction === 'outbound' ? 'outbound' : 'inbound';
	let content = createElement(SafeMessageText, { text: message.text ?? '' });
	if (message.contentType === 'AUDIO') {
		content = createElement(
			'div',
			null,
			createElement('strong', null, __('Voice message', 'moda-interact')),
			message.text
				? createElement(SafeMessageText, { text: message.text })
				: createElement(
						'p',
						null,
						__('Transcription unavailable', 'moda-interact')
					)
		);
	} else if (message.contentType !== 'TEXT') {
		content = createElement(
			'p',
			null,
			__('Unsupported message', 'moda-interact')
		);
	}
	return createElement(
		'li',
		{
			className: `moda-recovery-detail__bubble moda-recovery-detail__bubble--${direction}`,
		},
		createElement(
			'div',
			{ className: 'moda-recovery-detail__bubble-heading' },
			createElement('strong', null, senderLabel(message.sender)),
			message.createdAt
				? createElement(
						'time',
						{ dateTime: message.instant || undefined },
						message.time || message.createdAt
					)
				: null
		),
		content,
		message.moderationStatus === 'BLOCK'
			? createElement(
					'p',
					{ role: 'status' },
					__('Message blocked by moderation.', 'moda-interact')
				)
			: null,
		message.moderationStatus === 'REVIEW_REQUIRED'
			? createElement(
					'p',
					{ role: 'status' },
					__('Message requires review.', 'moda-interact')
				)
			: null,
		message.moderationStatus === 'RETRYABLE_ERROR'
			? createElement(
					'p',
					{ role: 'status' },
					__('Moderation temporarily unavailable.', 'moda-interact')
				)
			: null,
		message.deliveryStatus
			? createElement(
					'div',
					{ className: 'moda-recovery-detail__receipt' },
					message.deliveryStatus,
					message.sentAt
						? createElement('span', null, ` · ${message.sentAt}`)
						: null,
					message.deliveredAt
						? createElement(
								'span',
								null,
								` · ${message.deliveredAt}`
							)
						: null,
					message.readAt
						? createElement('span', null, ` · ${message.readAt}`)
						: null
				)
			: null
	);
}
