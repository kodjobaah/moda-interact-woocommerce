import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { formatDetailMoney } from '../recovery-detail-presentation';

/** Persisted snapshot, not live WooCommerce catalogue/pricing. */
export function CheckoutBasket({ basket }) {
	return createElement(
		'section',
		{
			className: 'moda-recovery-detail__basket',
			'aria-label': __('Checkout basket', 'moda-interact'),
		},
		createElement(
			'div',
			{ className: 'moda-recovery-detail__basket-total' },
			createElement(
				'span',
				null,
				__('Saved recovery total', 'moda-interact')
			),
			createElement(
				'strong',
				null,
				formatDetailMoney(basket?.recoveryTotal) ||
					__('Not available', 'moda-interact')
			)
		),
		basket?.items?.length
			? createElement(
					'p',
					{ className: 'moda-recovery-detail__basket-notice' },
					__(
						'Basket saved when this recovery was detected. Prices are not live.',
						'moda-interact'
					)
				)
			: null,
		!basket?.items?.length
			? createElement(
					'p',
					null,
					__('Saved checkout items unavailable.', 'moda-interact')
				)
			: createElement(
					'ul',
					{ className: 'moda-recovery-detail__basket-items' },
					...basket.items.map((item, index) =>
						createElement(
							'li',
							{ key: index },
							item.imageUrl
								? createElement('img', {
										src: item.imageUrl,
										alt: '',
										loading: 'lazy',
										width: 48,
										height: 48,
									})
								: null,
							createElement(
								'div',
								{
									className:
										'moda-recovery-detail__basket-product',
								},
								createElement(
									'strong',
									{ dir: 'auto' },
									item.title ||
										__('Item unavailable', 'moda-interact')
								),
								item.variantTitle
									? createElement(
											'p',
											{ dir: 'auto' },
											item.variantTitle
										)
									: null,
								createElement(
									'p',
									null,
									__('Quantity', 'moda-interact'),
									': ',
									item.quantity ??
										__('Unavailable', 'moda-interact')
								),
								formatDetailMoney(item.lineTotal)
									? createElement(
											'p',
											null,
											__('Line total', 'moda-interact'),
											': ',
											formatDetailMoney(item.lineTotal)
										)
									: null
							),
							formatDetailMoney(item.unitPrice)
								? createElement(
										'div',
										{
											className:
												'moda-recovery-detail__basket-price',
										},
										createElement(
											'span',
											null,
											__('Unit price', 'moda-interact')
										),
										createElement(
											'strong',
											null,
											formatDetailMoney(item.unitPrice)
										)
									)
								: null
						)
					)
				),
		basket?.unavailableReason
			? createElement(
					'p',
					{ role: 'status' },
					__(
						'Some saved checkout details are unavailable.',
						'moda-interact'
					)
				)
			: null
	);
}
