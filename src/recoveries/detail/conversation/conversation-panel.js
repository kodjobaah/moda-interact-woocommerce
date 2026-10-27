import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { ConversationMessage } from './conversation-message';
import { DetailSectionState } from '../states/detail-section-state';
import { HumanModeControls } from '../human/human-mode-controls';
import { HumanReplyComposer } from '../human/human-reply-composer';
import { HumanCommandStatus } from '../human/human-command-status';

// Show day breaks only for actual API-backed conversation messages.
function messageTimeline(messages) {
	const entries = [];
	let lastDay = null;
	for (const message of messages) {
		if (message.day && message.day !== lastDay) {
			entries.push(
				createElement(
					'li',
					{
						key: `day-${message.id}`,
						className: 'moda-recovery-detail__day',
					},
					message.day
				)
			);
		}
		lastDay = message.day;
		entries.push(
			createElement(ConversationMessage, { key: message.id, message })
		);
	}
	return entries;
}

/**
 * Independent conversation state and controls, including optional human actions.
 * @param {Object}                 root0
 * @param {string}                 root0.state
 * @param {Array<Object>}          root0.messages
 * @param {string|null}            root0.timeZone
 * @param {boolean}                root0.hasPrevious
 * @param {boolean}                root0.hasNext
 * @param {(() => void)|undefined} root0.onPrevious
 * @param {(() => void)|undefined} root0.onNext
 * @param {(() => void)|undefined} root0.onJumpLatest
 * @param {(() => void)|undefined} root0.onRefresh
 * @param {Object|null}            root0.summary
 * @param {Object|null}            root0.human
 */
export function ConversationPanel({
	state = 'UNAVAILABLE',
	messages = [],
	timeZone = null,
	hasPrevious = false,
	hasNext = false,
	onPrevious,
	onNext,
	onJumpLatest,
	onRefresh,
	summary = null,
	human = null,
}) {
	const busy = state === 'LOADING';
	return createElement(
		'section',
		{
			id: 'recovery-conversation',
			className:
				'moda-recovery-detail__card moda-recovery-detail__conversation',
			'aria-labelledby': 'moda-recovery-conversation-title',
			'aria-busy': busy,
		},
		createElement(
			'div',
			{ className: 'moda-recovery-detail__section-heading' },
			createElement(
				'h2',
				{ id: 'moda-recovery-conversation-title' },
				__('Conversation', 'moda-interact')
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: !onRefresh || busy,
					onClick: onRefresh,
				},
				__('Refresh', 'moda-interact')
			)
		),
		createElement(
			'p',
			{ className: 'moda-recovery-detail__timezone' },
			__('Time zone', 'moda-interact'),
			': ',
			timeZone || __('Not available', 'moda-interact')
		),
		summary?.conversation && human
			? createElement(HumanModeControls, { summary, human })
			: null,
		state === 'READY' && messages.length
			? createElement(
					'ol',
					{ className: 'moda-recovery-detail__messages' },
					...messageTimeline(messages)
				)
			: createElement(DetailSectionState, {
					state: state === 'READY' ? 'EMPTY' : state,
					emptyMessage: __(
						'No conversation recorded.',
						'moda-interact'
					),
				}),
		createElement(
			'nav',
			{
				className: 'moda-recovery-detail__paging',
				'aria-label': __('Conversation', 'moda-interact'),
			},
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: busy || !hasPrevious || !onPrevious,
					onClick: onPrevious,
				},
				__('Previous', 'moda-interact')
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: busy || !onJumpLatest,
					onClick: onJumpLatest,
				},
				__('Jump to latest', 'moda-interact')
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: busy || !hasNext || !onNext,
					onClick: onNext,
				},
				__('Next', 'moda-interact')
			)
		),
		summary?.conversation && human
			? createElement(HumanReplyComposer, {
					key: summary.conversation.id,
					summary,
					human,
				})
			: null,
		summary?.conversation && human
			? createElement(HumanCommandStatus, { human })
			: null
	);
}
