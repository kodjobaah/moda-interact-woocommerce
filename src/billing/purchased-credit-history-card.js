import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/**
 * Present the Shopify-equivalent purchased-credit management entry point.
 * @param {Object}     root0             - Card properties.
 * @param {() => void} root0.onManage    - Open the internal history view.
 * @param {boolean}    [root0.available] - Whether the API permits history.
 */
export function PurchasedCreditHistoryCard({ onManage, available = false }) {
	return createElement(
		'section',
		{
			className: 'moda-interact-purchased-credit-history',
			'aria-labelledby': 'moda-interact-purchased-credit-history-heading',
		},
		createElement(
			'div',
			{ className: 'moda-interact-purchased-credit-history__copy' },
			createElement(
				'p',
				{
					className:
						'moda-interact-purchased-credit-history__eyebrow',
				},
				__('Purchased recovery credits', 'moda-interact')
			),
			createElement(
				'h3',
				{ id: 'moda-interact-purchased-credit-history-heading' },
				__('Purchased credit history', 'moda-interact')
			),
			createElement(
				'p',
				{
					className:
						'moda-interact-purchased-credit-history__description',
				},
				__(
					'Review purchased credit lots and request refunds for unused credits.',
					'moda-interact'
				)
			)
		),
		createElement(
			'div',
			{ className: 'moda-interact-purchased-credit-history__action' },
			createElement(
				'button',
				{
					type: 'button',
					disabled: !available,
					onClick: onManage,
				},
				__('Manage purchased credits', 'moda-interact')
			),
			!available
				? createElement(
						'small',
						{ role: 'status' },
						__(
							'This section is not yet available for WooCommerce.',
							'moda-interact'
						)
					)
				: null
		)
	);
}
