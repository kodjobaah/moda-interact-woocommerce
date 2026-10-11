import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { canNavigateToWooRefund } from './purchase-history-contract';

/**
 * Woo owns monetary refund initiation. This is a validated, external link only.
 * @param {Object} root0          - Refund guidance inputs.
 * @param {Object} root0.purchase - Safe purchase history record.
 * @param {Object} root0.data     - Validated history and provider navigation.
 */
export function PurchaseRefundGuidance({ purchase, data }) {
	const allowed = canNavigateToWooRefund(purchase, data);
	if (!allowed) {
		if (purchase.refundAttempted) {
			return createElement(
				'p',
				{ className: 'moda-purchase-history__hint' },
				__(
					'This purchase already has a refund request.',
					'moda-interact'
				)
			);
		}
		return purchase.status === 'ACTIVE'
			? createElement(
					'p',
					{ className: 'moda-purchase-history__hint' },
					__(
						'This purchase is not eligible for a refund.',
						'moda-interact'
					)
				)
			: null;
	}
	return createElement(
		'div',
		{ className: 'moda-purchase-history__refund' },
		createElement(
			'a',
			{
				className: 'button button-primary',
				href: data.refundRequest.url,
				target: '_blank',
				rel: 'noopener noreferrer',
			},
			__('Request refund on WooCommerce.com', 'moda-interact')
		),
		createElement(
			'small',
			null,
			__('Opens WooCommerce.com in a new tab', 'moda-interact')
		)
	);
}
