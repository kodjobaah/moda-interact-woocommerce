import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { ConversationMessage } from './conversation-message';
import { DetailSectionState } from '../states/detail-section-state';

/**
 * Independent conversation state and controls; Stage 1 has no active API actions.
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
}) {
	const busy = state === 'LOADING';
	return createElement(
		'section',
		{
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
			null,
			__('Read-only conversation history.', 'moda-interact')
		),
		createElement(
			'p',
			null,
			__('Time zone', 'moda-interact'),
			': ',
			timeZone || __('Not available', 'moda-interact')
		),
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
		state === 'READY' && messages.length
			? createElement(
					'ol',
					{ className: 'moda-recovery-detail__messages' },
					...messages.map((message) =>
						createElement(ConversationMessage, {
							key: message.id,
							message,
						})
					)
				)
			: createElement(DetailSectionState, {
					state: state === 'READY' ? 'EMPTY' : state,
					emptyMessage: __(
						'No conversation recorded.',
						'moda-interact'
					),
				})
	);
}
