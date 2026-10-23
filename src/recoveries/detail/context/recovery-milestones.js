import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const MILESTONES = ['started', 'sent', 'engaged', 'recovered', 'expired'];

function milestoneLabel(key) {
	switch (key) {
		case 'started':
			return __('Started', 'moda-interact');
		case 'sent':
			return __('Initial outreach', 'moda-interact');
		case 'engaged':
			return __('Engaged', 'moda-interact');
		case 'recovered':
			return __('Completed', 'moda-interact');
		case 'expired':
			return __('Expired', 'moda-interact');
		default:
			return null;
	}
}

/**
 * Render recorded recovery events, not inferred timestamps or follow-up sends.
 * @param {Object}      root0
 * @param {Object|null} root0.milestones
 * @param {boolean}     root0.followUpUsed
 */
export function RecoveryMilestones({
	milestones = null,
	followUpUsed = false,
}) {
	const entries = MILESTONES.filter((key) => milestones?.[key]);
	return createElement(
		'section',
		{ className: 'moda-recovery-detail__milestones-section' },
		createElement('h2', null, __('Recovery activity', 'moda-interact')),
		entries.length
			? createElement(
					'ol',
					{ className: 'moda-recovery-detail__milestones' },
					...entries.map((key) =>
						createElement(
							'li',
							{ key },
							createElement('strong', null, milestoneLabel(key)),
							createElement('span', null, milestones[key])
						)
					)
				)
			: createElement(
					'p',
					{ role: 'status' },
					__(
						'This section is not yet available for WooCommerce.',
						'moda-interact'
					)
				),
		createElement(
			'div',
			{ className: 'moda-recovery-detail__follow-up-state' },
			createElement('strong', null, __('Follow-up', 'moda-interact')),
			createElement(
				'span',
				null,
				followUpUsed
					? __(
							'The recovery follow-up was already used.',
							'moda-interact'
						)
					: __(
							'Recovery follow-up is not available.',
							'moda-interact'
						)
			)
		)
	);
}
