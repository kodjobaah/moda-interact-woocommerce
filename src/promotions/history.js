import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { PromotionPager } from './presentation';

const display = (value) =>
	value === null || value === undefined ? '—' : String(value);

function historyStatus(status) {
	if (status === 'EXPIRED') {
		return __('Expired', 'moda-interact');
	}
	if (status === 'EXHAUSTED') {
		return __('Exhausted', 'moda-interact');
	}
	if (status === 'ACTIVE') {
		return __('Active', 'moda-interact');
	}
	return __('Unavailable', 'moda-interact');
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
									display(entry.quantityGranted)
								)
							),
							createElement(
								'p',
								null,
								sprintf(
									/* translators: %s: promotional credits consumed. */
									__('Used %s', 'moda-interact'),
									display(entry.committedQuantity)
								)
							),
							createElement(
								'p',
								null,
								sprintf(
									/* translators: %s: promotional credits remaining. */
									__('Remaining %s', 'moda-interact'),
									display(entry.remainingQuantity)
								)
							),
							createElement(
								'p',
								null,
								sprintf(
									/* translators: %s: last promotion-selection date. */
									__('Selected %s', 'moda-interact'),
									display(entry.lastSelectedAt)
								)
							),
							createElement(
								'p',
								null,
								sprintf(
									/* translators: %s: promotion expiry date. */
									__('Expires %s', 'moda-interact'),
									display(entry.expiresAt)
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
