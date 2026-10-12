import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

/**
 * @param {Object}               root0
 * @param {Array<Object>}        root0.items
 * @param {number|null}          root0.selectedId
 * @param {(id: number) => void} root0.onSelect
 * @return {Object} Read-only coupon previews with local radio selection.
 */
export function CouponPreviewList({ items, selectedId, onSelect }) {
	return createElement(
		'ul',
		{ className: 'moda-coupon-preview__results' },
		...items.map((item) => {
			const selectable = item.previewStatus === 'REVIEW_REQUIRED';
			const amount =
				item.type === 'percent'
					? `${item.amount}%`
					: `${item.currency} ${item.amount}`;
			let reason = __('Unavailable', 'moda-interact');
			if (item.previewStatus === 'REVIEW_REQUIRED') {
				reason = __('Review required', 'moda-interact');
			} else if (item.previewStatus === 'EXPIRED') {
				reason = __('Expired', 'moda-interact');
			}
			return createElement(
				'li',
				{ key: item.id },
				createElement(
					'label',
					{ className: 'moda-coupon-preview__item' },
					createElement('input', {
						type: 'radio',
						name: 'wooCouponLocalPreview',
						value: item.id,
						checked: selectedId === item.id,
						disabled: !selectable,
						onChange: () => onSelect(item.id),
						'aria-label': sprintf(
							/* translators: %s: WooCommerce coupon code offered for local preview selection. */
							__('Select for preview: %s', 'moda-interact'),
							item.code
						),
					}),
					createElement(
						'span',
						{ className: 'moda-coupon-preview__code', dir: 'auto' },
						item.code
					),
					createElement(
						'span',
						{ className: 'moda-coupon-preview__amount' },
						amount
					),
					createElement('small', null, reason)
				)
			);
		})
	);
}
