import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { RecoveryMilestones } from './recovery-milestones';
import { RelatedRecoveries } from './related-recoveries';

/**
 * Native details/summary handles expansion accessibly without a new router.
 * @param {Object}      root0
 * @param {Object|null} root0.milestones
 * @param {Object}      root0.related
 */
export function CheckoutContextPanel({ milestones = null, related = {} }) {
	return createElement(
		'aside',
		{ className: 'moda-recovery-detail__aside' },
		createElement(
			'details',
			{ className: 'moda-recovery-detail__card', open: true },
			createElement(
				'summary',
				null,
				__('Checkout context', 'moda-interact')
			),
			createElement(
				'div',
				{ className: 'moda-recovery-detail__context-body' },
				createElement(RecoveryMilestones, { milestones }),
				createElement(RelatedRecoveries, related)
			)
		)
	);
}
