import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { RecoveryStatusBadge } from '../list/recovery-status-badge';

function SummaryField({ label, value }) {
	return createElement(
		'div',
		null,
		createElement('dt', null, label),
		createElement('dd', null, value ?? __('Unavailable', 'moda-interact'))
	);
}

/**
 * Read-only summary; production never substitutes list values for absent detail data.
 * @param {Object}      root0
 * @param {Object|null} root0.detail
 */
export function RecoveryDetailHeader({ detail = null }) {
	const name =
		detail?.customerName || __('Recovery details', 'moda-interact');
	return createElement(
		'header',
		{ className: 'moda-recovery-detail__header' },
		createElement(
			'div',
			{ className: 'moda-recovery-detail__customer' },
			createElement('p', null, __('Recovery details', 'moda-interact')),
			createElement(
				'h1',
				{ id: 'moda-recovery-detail-heading', dir: 'auto' },
				name
			),
			detail?.customerEmail
				? createElement('p', { dir: 'auto' }, detail.customerEmail)
				: null
		),
		createElement(
			'dl',
			{ className: 'moda-recovery-detail__summary' },
			createElement(SummaryField, {
				label: __('Checkout value', 'moda-interact'),
				value: detail?.checkoutValue,
			}),
			createElement(SummaryField, {
				label: __('Status', 'moda-interact'),
				value: detail?.status
					? createElement(RecoveryStatusBadge, {
							status: detail.status,
						})
					: null,
			}),
			createElement(SummaryField, {
				label: __('Started', 'moda-interact'),
				value: detail?.startedAt,
			})
		)
	);
}
