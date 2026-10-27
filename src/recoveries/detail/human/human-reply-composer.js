import { createElement, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { humanActionAvailability } from './conversation-command-contract';
import { FollowUpTemplatePicker } from './follow-up-template-picker';

function errorLabel(error) {
	switch (error) {
		case 'STALE_CONTROL_REVISION':
		case 'CONVERSATION_CONTROL_CONFLICT':
			return __(
				'Conversation changed. Refresh before retrying.',
				'moda-interact'
			);
		case 'HUMAN_MESSAGING_SUSPENDED':
			return __(
				'Human messaging is unavailable for this store.',
				'moda-interact'
			);
		case 'SERVICE_WINDOW_CLOSED':
			return __(
				'The customer service window is closed.',
				'moda-interact'
			);
		case 'FOLLOW_UP_UNAVAILABLE':
			return __('Recovery follow-up is not available.', 'moda-interact');
		case 'TEMPLATE_NOT_ALLOWED':
			return __(
				'Approved follow-up template unavailable.',
				'moda-interact'
			);
		case 'HUMAN_CONTENT_INVALID':
			return __('Please revise the message.', 'moda-interact');
		default:
			return __(
				'Unable to confirm the command. Check status before retrying.',
				'moda-interact'
			);
	}
}

// Composer stays below the transcript; it never starts a second send while a command exists.
export function HumanReplyComposer({ summary, human }) {
	const [draft, setDraft] = useState('');
	const actions = humanActionAvailability(
		summary,
		Date.now(),
		human?.templates
	);
	const pending = human?.busy || human?.checking || !!human?.command;
	const submit = async (event) => {
		event.preventDefault();
		const message = draft.trim();
		if (!message || !actions.canText || pending) {
			return;
		}
		if (await human.onSendText(message)) {
			setDraft('');
		}
	};
	return createElement(
		'div',
		{ className: 'moda-recovery-detail__reply-region' },
		actions.canText || (actions.mode === 'HUMAN' && actions.windowOpen)
			? createElement(
					'form',
					{
						onSubmit: submit,
						className: 'moda-recovery-detail__composer',
					},
					createElement(
						'label',
						{ htmlFor: 'moda-recovery-human-text' },
						__('Reply to customer', 'moda-interact')
					),
					createElement('textarea', {
						id: 'moda-recovery-human-text',
						value: draft,
						rows: 3,
						maxLength: 4000,
						dir: 'auto',
						disabled: !actions.canText || pending,
						onChange: (event) => setDraft(event.target.value),
					}),
					createElement(
						'div',
						{ className: 'moda-recovery-detail__composer-actions' },
						createElement(
							'button',
							{
								type: 'submit',
								className: 'button button-primary',
								disabled:
									!actions.canText ||
									pending ||
									!draft.trim(),
							},
							__('Queue reply', 'moda-interact')
						)
					)
				)
			: null,
		actions.canText || (actions.mode === 'HUMAN' && actions.windowOpen)
			? createElement(
					'p',
					{ className: 'moda-recovery-detail__muted' },
					__(
						'A queued reply is not a confirmed WhatsApp send.',
						'moda-interact'
					)
				)
			: null,
		createElement(FollowUpTemplatePicker, { summary, human }),
		human?.error
			? createElement('p', { role: 'alert' }, errorLabel(human.error))
			: null,
		human?.error && human?.retryable && !human.command
			? createElement(
					'button',
					{
						type: 'button',
						className: 'button',
						disabled: human.busy,
						onClick: human.onRetry,
					},
					__('Retry same request', 'moda-interact')
				)
			: null
	);
}
