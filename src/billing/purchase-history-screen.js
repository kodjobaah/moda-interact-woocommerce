import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { PurchaseHistoryFilters } from './purchase-history-filters';
import { PurchaseHistoryPagination } from './purchase-history-pagination';
import { PurchaseHistoryCard } from './purchase-history-card';

/**
 * Shopify-aligned presentation inside the existing native WordPress Billing page.
 * @param {Object}     root0         - History screen properties.
 * @param {Object}     root0.history - Controller-backed history state/actions.
 * @param {() => void} root0.onBack  - Return to billing.
 * @param {string}     root0.locale  - Administrator UI locale.
 */
export function PurchaseHistoryScreen({ history, onBack, locale }) {
	const { state, setFilter, setPageSize, setPage, refresh } = history;
	const loading = state.status === 'IDLE' || state.status === 'LOADING';
	const data = state.data;
	let content;
	if (loading) {
		content = createElement(
			'p',
			{ role: 'status' },
			__('Loading purchase history…', 'moda-interact')
		);
	} else if (state.status === 'FAILED') {
		content = createElement(
			'div',
			null,
			createElement(
				'p',
				{
					role: 'alert',
					className:
						'moda-interact-message moda-interact-message--error',
				},
				__(
					'Purchase history could not be loaded. Please try again.',
					'moda-interact'
				)
			),
			createElement(
				'button',
				{ type: 'button', onClick: refresh },
				__('Retry', 'moda-interact')
			)
		);
	} else {
		content = createElement(
			'div',
			{
				className: 'moda-purchase-history__results',
				'aria-live': 'polite',
			},
			data.purchases.length === 0
				? createElement(
						'p',
						{
							className: 'moda-purchase-history__empty',
							role: 'status',
						},
						__('No purchases match this view.', 'moda-interact')
					)
				: createElement(
						'div',
						{ className: 'moda-purchase-history__list' },
						...data.purchases.map((purchase) =>
							createElement(PurchaseHistoryCard, {
								key: purchase.id,
								purchase,
								data,
								locale,
							})
						)
					),
			createElement(PurchaseHistoryPagination, {
				data,
				pageSize: state.pageSize,
				disabled: loading,
				onPageChange: setPage,
				onPageSizeChange: setPageSize,
				locale,
			})
		);
	}
	return createElement(
		'div',
		{ className: 'moda-purchase-history' },
		createElement(
			'nav',
			{
				className: 'moda-purchase-history__breadcrumb',
				'aria-label': __('Billing', 'moda-interact'),
			},
			createElement(
				'button',
				{ type: 'button', onClick: onBack },
				__('Back to billing', 'moda-interact')
			),
			createElement('span', { 'aria-hidden': true }, ' / '),
			createElement(
				'span',
				null,
				__('Purchased credit history', 'moda-interact')
			)
		),
		createElement(
			'section',
			{
				className: 'moda-purchase-history__panel',
				'aria-labelledby': 'moda-purchase-history-title',
			},
			createElement(
				'header',
				null,
				createElement(
					'p',
					{
						className:
							'moda-interact-purchased-credit-history__eyebrow',
					},
					__('Purchased recovery credits', 'moda-interact')
				),
				createElement(
					'h2',
					{ id: 'moda-purchase-history-title' },
					__('Purchased credit history', 'moda-interact')
				),
				createElement(
					'p',
					null,
					__(
						'Review purchased credit lots and request refunds for unused credits.',
						'moda-interact'
					)
				)
			),
			createElement(PurchaseHistoryFilters, {
				filter: state.filter,
				onFilterChange: setFilter,
				disabled: loading,
			}),
			content,
			createElement(
				'p',
				{ className: 'moda-purchase-history__help' },
				__(
					'Open WooCommerce.com Orders to request a refund for a Moda Interact purchase. Moda updates credits only after the provider and vendor verify the outcome.',
					'moda-interact'
				)
			)
		)
	);
}
