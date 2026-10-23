import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { RecoveryMilestones } from './recovery-milestones';
import { RelatedRecoveries } from './related-recoveries';
import { CheckoutBasket } from './checkout-basket';

/**
 * The three independent cards mirror Shopify Recovery Detail. They retain
 * WooCommerce's existing API-backed basket, timeline and related pagination.
 *
 * @param {Object}      root0
 * @param {Object|null} root0.milestones
 * @param {Object}      root0.related
 * @param {Object|null} root0.basket
 * @param {boolean}     root0.followUpUsed
 */
export function CheckoutContextPanel({
	milestones = null,
	related = {},
	basket = null,
	followUpUsed = false,
}) {
	const hasRelated = related.state === 'READY' && related.items?.length > 0;
	return createElement(
		'aside',
		{ className: 'moda-recovery-detail__aside' },
		createElement(
			'details',
			{
				className:
					'moda-recovery-detail__card moda-recovery-detail__basket-card',
				open: true,
			},
			createElement(
				'summary',
				null,
				createElement(
					'h2',
					null,
					__('Checkout basket', 'moda-interact')
				)
			),
			createElement(CheckoutBasket, { basket })
		),
		createElement(
			'section',
			{
				className:
					'moda-recovery-detail__card moda-recovery-detail__activity-card',
			},
			createElement(RecoveryMilestones, { milestones, followUpUsed })
		),
		createElement(
			'details',
			{
				className:
					'moda-recovery-detail__card moda-recovery-detail__related-card',
				open: Boolean(hasRelated),
			},
			createElement(
				'summary',
				null,
				createElement(
					'h2',
					{ id: 'moda-recovery-related-title' },
					__('Related recoveries', 'moda-interact')
				)
			),
			createElement(RelatedRecoveries, related)
		)
	);
}
