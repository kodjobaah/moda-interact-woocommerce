import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

function effectiveOffer(mode) {
	switch (mode) {
		case 'NONE':
			return __('Do not offer a discount', 'moda-interact');
		case 'FIXED':
			return __('Specific discount', 'moda-interact');
		case 'AI_BEST_APPLICABLE':
			return __('AI-selected applicable discount', 'moda-interact');
		default:
			return __('Unavailable', 'moda-interact');
	}
}

function effectiveFollowUp(data, placeholder) {
	if (!data) {
		return placeholder;
	}
	if (!data.followUpEnabled) {
		return __('Effective follow-up: disabled', 'moda-interact');
	}
	return sprintf(
		/* translators: %d: minutes until automatic follow-up. */
		__('Effective follow-up: %d minutes', 'moda-interact'),
		data.followUpDelayMinutes
	);
}

// Presentation only: never substitute guesses for a failed policy read.
export function RecoveryEffectiveSummary({ state, onRetry }) {
	const ready = state?.status === 'READY' && state.data;
	const data = ready ? state.data : null;
	const placeholder =
		state?.status === 'LOADING'
			? __('Loading…', 'moda-interact')
			: __('Unavailable', 'moda-interact');
	const cards = [
		{
			label: __('Recovery start', 'moda-interact'),
			value: data
				? sprintf(
						/* translators: %d: number of minutes before recovery starts. */
						__('Effective value: %d minutes', 'moda-interact'),
						data.recoveryDelayMinutes
					)
				: placeholder,
		},
		{
			label: __('Recovery offer', 'moda-interact'),
			value: data
				? sprintf(
						/* translators: %s: effective offer setting. */
						__('Currently active: %s', 'moda-interact'),
						effectiveOffer(data.recoveryOfferMode)
					)
				: placeholder,
		},
		{
			label: __('No-response follow-up', 'moda-interact'),
			value: effectiveFollowUp(data, placeholder),
		},
	];
	const extras = [];
	if (data?.source === 'ADMIN_OVERRIDE') {
		extras.push(
			createElement(
				'span',
				{
					className: 'moda-interact-recovery__override',
					role: 'status',
				},
				__(
					'Effective settings include an administrator override',
					'moda-interact'
				)
			)
		);
	}
	if (state?.status === 'ERROR') {
		extras.push(
			createElement(
				'button',
				{ type: 'button', className: 'button', onClick: onRetry },
				__('Retry recovery summary', 'moda-interact')
			)
		);
	}
	return createElement(
		'div',
		{
			className: 'moda-interact-recovery__effective-grid',
			'aria-label': __('Effective recovery settings', 'moda-interact'),
		},
		...cards.map(({ label, value }) =>
			createElement(
				'div',
				{
					className: 'moda-interact-recovery__effective-card',
					key: label,
				},
				createElement('span', null, label),
				createElement('strong', null, value)
			)
		),
		...extras
	);
}
