import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { HISTORY_PAGE_SIZES } from './purchase-history-contract';
import { formatQuantity } from './presentation-formatters';

export function PurchaseHistoryPagination({
	data,
	pageSize,
	disabled,
	onPageChange,
	onPageSizeChange,
	locale,
}) {
	const first = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
	const last = Math.min(data.page * data.pageSize, data.total);
	/* translators: %s: number of purchases per page. */
	const perPageTemplate = __('%s per page', 'moda-interact');
	/* translators: 1: first purchase; 2: last purchase; 3: total purchases. */
	const rangeTemplate = __('%1$s–%2$s of %3$s', 'moda-interact');
	/* translators: 1: current page; 2: total number of pages. */
	const pageTemplate = __('Page %1$s of %2$s', 'moda-interact');
	return createElement(
		'div',
		{ className: 'moda-purchase-history__pagination' },
		createElement(
			'label',
			{ className: 'moda-purchase-history__page-size' },
			createElement(
				'span',
				{ className: 'screen-reader-text' },
				__('Purchase history pages', 'moda-interact')
			),
			createElement(
				'select',
				{
					value: pageSize,
					disabled,
					'aria-label': __('Purchase history pages', 'moda-interact'),
					onChange: (event) =>
						onPageSizeChange(Number(event.target.value)),
				},
				...HISTORY_PAGE_SIZES.map((size) =>
					createElement(
						'option',
						{ key: size, value: size },
						sprintf(perPageTemplate, formatQuantity(size, locale))
					)
				)
			)
		),
		createElement(
			'nav',
			{ 'aria-label': __('Purchase history pages', 'moda-interact') },
			createElement(
				'span',
				null,
				sprintf(
					rangeTemplate,
					formatQuantity(first, locale),
					formatQuantity(last, locale),
					formatQuantity(data.total, locale)
				)
			),
			createElement(
				'button',
				{
					type: 'button',
					disabled: disabled || data.page <= 1,
					onClick: () => onPageChange(data.page - 1),
				},
				__('Previous', 'moda-interact')
			),
			createElement(
				'span',
				null,
				sprintf(
					pageTemplate,
					formatQuantity(data.page, locale),
					formatQuantity(data.totalPages, locale)
				)
			),
			createElement(
				'button',
				{
					type: 'button',
					disabled: disabled || data.page >= data.totalPages,
					onClick: () => onPageChange(data.page + 1),
				},
				__('Next', 'moda-interact')
			)
		)
	);
}
