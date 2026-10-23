import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { humanActionAvailability } from './conversation-command-contract';

function windowDeadline(expires, timeZone) {
	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone,
		}).format(new Date(expires));
	} catch {
		return '';
	}
}

// Shopify-aligned control and availability region; no message submission here.
export function HumanModeControls({ summary, human }) {
	const actions = humanActionAvailability(summary);
	let modeLabel = __('Unavailable', 'moda-interact');
	if (actions.mode === 'HUMAN') {
		modeLabel = __('Merchant in control', 'moda-interact');
	}
	if (actions.mode === 'AI') {
		modeLabel = __('Moda assistant', 'moda-interact');
	}
	const busy = human?.busy || human?.checking || !!human?.command;
	const deadline = actions.windowOpen
		? windowDeadline(summary.conversation.windowExpiresAt, summary.timeZone)
		: null;
	return createElement(
		'div',
		{
			className: 'moda-recovery-detail__human-controls',
			'aria-label': __('Human conversation controls', 'moda-interact'),
		},
		createElement(
			'div',
			{ className: 'moda-recovery-detail__human-mode' },
			createElement(
				'span',
				{ className: 'moda-recovery-detail__human-mode-status' },
				createElement('span', {
					className: 'moda-recovery-detail__control-indicator',
					'aria-hidden': true,
				}),
				createElement('strong', null, modeLabel)
			),
			actions.canTakeOver
				? createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled: busy,
							onClick: human.onTakeOver,
						},
						__('Take Over', 'moda-interact')
					)
				: null,
			actions.canResumeAI
				? createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled: busy,
							onClick: human.onResumeAI,
						},
						__('Resume AI', 'moda-interact')
					)
				: null
		),
		createElement(
			'div',
			{ className: 'moda-recovery-detail__availability', role: 'status' },
			createElement(
				'p',
				null,
				actions.windowOpen && deadline
					? `${__('Customer reply window open until', 'moda-interact')} ${deadline}`
					: __('Customer service window closed.', 'moda-interact')
			),
			actions.suspended
				? createElement(
						'p',
						null,
						__(
							'Human messaging is unavailable for this store.',
							'moda-interact'
						)
					)
				: null,
			actions.mode === 'AI' && !actions.suspended
				? createElement(
						'p',
						null,
						__(
							'Take Over to reply as the merchant.',
							'moda-interact'
						)
					)
				: null,
			actions.mode === 'HUMAN' &&
				!actions.windowOpen &&
				!actions.suspended
				? createElement(
						'p',
						null,
						actions.followUpUsed
							? __(
									'The recovery follow-up was already used.',
									'moda-interact'
								)
							: __(
									'No server-approved recovery follow-up template is currently available.',
									'moda-interact'
								)
					)
				: null
		)
	);
}
