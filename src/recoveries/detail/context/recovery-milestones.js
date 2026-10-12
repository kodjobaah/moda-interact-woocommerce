import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const MILESTONES = ['started', 'sent', 'engaged', 'recovered', 'expired'];

function milestoneLabel(key) {
	switch (key) {
		case 'started':
			return __('Started', 'moda-interact');
		case 'sent':
			return __('Message sent', 'moda-interact');
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
 * Only display actual provided milestones, never an assumed event timeline.
 * @param {Object}      root0
 * @param {Object|null} root0.milestones
 */
export function RecoveryMilestones({ milestones = null }) {
	const entries = MILESTONES.filter((key) => milestones?.[key]);
	return createElement(
		'section',
		{ className: 'moda-recovery-detail__milestones-section' },
		createElement('h3', null, __('Milestones', 'moda-interact')),
		entries.length
			? createElement(
					'dl',
					{ className: 'moda-recovery-detail__milestones' },
					...entries.map((key) =>
						createElement(
							'div',
							{ key },
							createElement('dt', null, milestoneLabel(key)),
							createElement('dd', null, milestones[key])
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
				)
	);
}
