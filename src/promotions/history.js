import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { PromotionPager } from './presentation';
import { formatDate, formatQuantity } from '../billing/presentation-formatters';

const display = (value) =>
	value === null || value === undefined ? '—' : String(value);

function historyStatus(status) {
	const values = {
		SELECTED: __('Selected', 'moda-interact'),
		USED: __('Used', 'moda-interact'),
		EXHAUSTED: __('Exhausted', 'moda-interact'),
		EXPIRED: __('Expired', 'moda-interact'),
		CLOSED: __('Closed', 'moda-interact'),
		NO_LONGER_ELIGIBLE: __('No longer eligible', 'moda-interact'),
		REOPENED: __('Reopened', 'moda-interact'),
	};
	return values[status] ?? __('Unavailable', 'moda-interact');
}

/**
 * Present the authoritative history projection; never manufacture grant data.
 *
 * @param {Object}                        root0         Component properties.
 * @param {Object}                        root0.history History projection.
 * @param {number}                        root0.page    Current page.
 * @param {((page: number) => void)|null} root0.onPage  Authorised page callback.
 * @return {Object} History disclosure.
 */
export function PromotionHistory({
	history = { entries: [], totalEntries: 0 },
	page = 1,
	onPage = null,
}) {
	const entries = history.entries ?? [];
	const totalPages = Math.max(1, history.totalPages ?? 1);
	return createElement(
		'details',
		{ className: 'moda-promotions__history', open: true },
		createElement(
			'summary',
			null,
			createElement(
				'div',
				{ className: 'moda-promotions__section-head' },
				createElement(
					'span',
					{ className: 'moda-promotions__eyebrow' },
					__('Promotion history', 'moda-interact')
				),
				createElement(
					'h2',
					null,
					__('Promotion history', 'moda-interact')
				)
			),
			createElement(
				'span',
				{ className: 'moda-promotions__history-count' },
				String(history.totalEntries ?? entries.length)
			)
		),
		entries.length
			? createElement(
					'div',
					{ className: 'moda-promotions__history-list' },
					...entries.map((entry) =>
						createElement(
							'article',
							{
								key: entry.campaignId,
								className: 'moda-promotions__history-entry',
							},
							createElement(
								'h3',
								{ dir: 'auto' },
								display(entry.campaignTitle)
							),
							createElement(
								'p',
								null,
								historyStatus(entry.status)
							),
							createElement(
								'p',
								null,
								sprintf(
									/* translators: %s: total promotional credits granted. */
									__('Granted %s', 'moda-interact'),
									formatQuantity(entry.quantityGranted)
								)
							),
							createElement(
								'p',
								null,
								sprintf(
									/* translators: %s: promotional credits consumed. */
									__('Used %s', 'moda-interact'),
									formatQuantity(entry.committedQuantity)
								)
							),
							createElement(
								'p',
								null,
								sprintf(
									/* translators: %s: promotional credits remaining. */
									__('Remaining %s', 'moda-interact'),
									formatQuantity(entry.remainingQuantity)
								)
							),
							createElement(
								'p',
								null,
								sprintf(
									/* translators: %s: last promotion-selection date. */
									__('Selected %s', 'moda-interact'),
									entry.lastSelectedAt ? formatDate(entry.lastSelectedAt) : '—'
								)
							),
							createElement(
								'p',
								null,
								sprintf(
									/* translators: %s: promotion expiry date. */
									__('Expires %s', 'moda-interact'),
									formatDate(entry.expiresAt)
								)
							)
						)
					)
				)
			: createElement(
					'p',
					{ className: 'moda-promotions__empty' },
					__('No promotion history.', 'moda-interact')
				),
		createElement(PromotionPager, { page, totalPages, onPage })
	);
}
