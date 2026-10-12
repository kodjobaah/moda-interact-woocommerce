import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { RecoveryStatusBadge } from './recovery-status-badge';

function Detail({ label, children }) {
	return createElement(
		'div',
		null,
		createElement('dt', null, label),
		createElement('dd', null, children)
	);
}

/**
 * Presentation-only DTO; no checkout/customer fixtures are bundled into production.
 *
 * @param {Object}      root0            - Component props.
 * @param {Object}      root0.item       - Recovery row.
 * @param {string|null} root0.detailHref - WordPress Admin detail URL when available.
 * @return {Object} Row element.
 */
export function RecoveryRow({ item, detailHref = null }) {
	return createElement(
		'li',
		{ className: 'moda-recoveries__row' },
		createElement(
			'div',
			{ className: 'moda-recoveries__customer' },
			createElement(
				'h3',
				{ dir: 'auto' },
				detailHref
					? createElement(
							'a',
							{ href: detailHref },
							item.customerName || __('Guest', 'moda-interact')
						)
					: item.customerName || __('Guest', 'moda-interact')
			),
			item.customerEmail
				? createElement('p', { dir: 'auto' }, item.customerEmail)
				: null,
			item.checkoutDate
				? createElement(
						'p',
						null,
						sprintf(
							/* translators: %s: the checkout date shown to the merchant. */
							__('Checkout · %s', 'moda-interact'),
							item.checkoutDate
						)
					)
				: null
		),
		createElement(
			'dl',
			{ className: 'moda-recoveries__row-metadata' },
			createElement(
				Detail,
				{ label: __('Status', 'moda-interact') },
				createElement(RecoveryStatusBadge, { status: item.status })
			),
			createElement(
				Detail,
				{ label: __('Checkout value', 'moda-interact') },
				item.checkoutValue || __('Unavailable', 'moda-interact')
			),
			createElement(
				Detail,
				{ label: __('Started', 'moda-interact') },
				item.startedAt || __('Unavailable', 'moda-interact')
			)
		)
	);
}
