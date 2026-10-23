import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const FINISHED = new Set(['SENT', 'FAILED', 'CANCELLED']);

function statusLabel(command) {
	if (FINISHED.has(command.state)) {
		if (command.state === 'SENT') {
			return __('Provider confirmed sent.', 'moda-interact');
		}
		if (command.state === 'FAILED') {
			return __('Message failed.', 'moda-interact');
		}
		return __('Message cancelled.', 'moda-interact');
	}
	if (command.moderationStatus === 'moderation_blocked') {
		return __('Message blocked. Nothing was sent.', 'moda-interact');
	}
	if (command.moderationStatus === 'moderation_review_required') {
		return __('Message requires review.', 'moda-interact');
	}
	if (command.moderationStatus === 'moderation_retryable_error') {
		return __(
			'Message screening unavailable. Check status before retrying.',
			'moda-interact'
		);
	}
	if (command.moderationStatus === 'moderation_pending') {
		return __('Checking message…', 'moda-interact');
	}
	if (['ACCEPTED', 'CLAIMED', 'DISPATCH_ADMITTED'].includes(command.state)) {
		return __('Accepted / queued. Not yet sent.', 'moda-interact');
	}
	return __('Delivery outcome unknown. Check status.', 'moda-interact');
}

// A manual status read must have visible feedback even when FAILED remains FAILED.
export function HumanCommandStatus({ human }) {
	const command = human?.command;
	if (!command) {
		return null;
	}
	const checked = human.checkedAt ? new Date(human.checkedAt) : null;
	return createElement(
		'div',
		{
			className: 'moda-recovery-detail__command',
			role: 'status',
			'aria-live': 'polite',
		},
		createElement('strong', null, __('Status', 'moda-interact')),
		createElement('p', null, statusLabel(command)),
		checked && !Number.isNaN(checked.getTime())
			? createElement(
					'p',
					{
						className: 'moda-recovery-detail__checked',
					},
					__('Status', 'moda-interact'),
					': ',
					createElement(
						'time',
						{
							dateTime: human.checkedAt,
						},
						checked.toLocaleTimeString()
					)
				)
			: null,
		createElement(
			'div',
			{ className: 'moda-recovery-detail__command-actions' },
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: human.busy || human.checking,
					'aria-busy': !!human.checking,
					onClick: human.onCheckStatus,
				},
				human.checking
					? __('Checking…', 'moda-interact')
					: __('Check status', 'moda-interact')
			),
			FINISHED.has(command.state)
				? createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled: human.busy || human.checking,
							onClick: human.onAcknowledge,
						},
						__('Done', 'moda-interact')
					)
				: null
		)
	);
}
