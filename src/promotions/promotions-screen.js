import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { PromotionCards, PromotionPager } from './presentation';
import { PromotionHistory } from './history';

function nonReadyMessage(status) {
	if (status === 'LOADING') {
		return __('Loading…', 'moda-interact');
	}
	if (status === 'ERROR' || status === 'DENIED') {
		return __('This section could not be loaded.', 'moda-interact');
	}
	return __(
		'Promotion offers are not yet available for WooCommerce.',
		'moda-interact'
	);
}

/**
 * Render only authoritative states. Production has no approved promotions API
 * adapter under ARCH-035; it passes the default UNAVAILABLE model and never
 * enables campaign selection. READY states are used in component fixtures.
 *
 * @param {Object}                              root0               Component properties.
 * @param {Object}                              root0.model         Authoritative state.
 * @param {((campaignId: string) => void)|null} root0.onSelect      Selection callback.
 * @param {((page: number) => void)|null}       root0.onOffersPage  Offer paging callback.
 * @param {((page: number) => void)|null}       root0.onHistoryPage History paging callback.
 * @return {Object} Promotions screen.
 */
export function PromotionsScreen({
	model = { status: 'UNAVAILABLE' },
	onSelect = null,
	onOffersPage = null,
	onHistoryPage = null,
}) {
	const ready = model.status === 'READY';
	const selected = ready ? model.selection : null;
	const offers = ready ? (model.offers ?? []) : [];
	const pagination = ready ? (model.offersPagination ?? {}) : {};
	let offerBody;
	if (!ready) {
		offerBody = createElement(
			'p',
			{
				role: ['ERROR', 'DENIED'].includes(model.status)
					? 'alert'
					: 'status',
				className: 'moda-promotions__empty',
			},
			nonReadyMessage(model.status)
		);
	} else if (offers.length === 0) {
		offerBody = createElement(
			'p',
			{ role: 'status', className: 'moda-promotions__empty' },
			__('No promotions available.', 'moda-interact')
		);
	} else {
		offerBody = createElement(PromotionCards, {
			offers: offers.filter((offer) => offer.id !== selected?.campaignId),
			selected,
			locked: selected?.locked,
			busy: model.saving === true,
			onSelect,
		});
	}

	return createElement(
		'section',
		{
			className: 'moda-promotions',
			'aria-labelledby': 'moda-promotions-heading',
		},
		createElement(
			'header',
			{ className: 'moda-promotions__intro' },
			createElement(
				'span',
				{ className: 'moda-promotions__eyebrow' },
				__('Promotions', 'moda-interact')
			),
			createElement(
				'h1',
				{ id: 'moda-promotions-heading' },
				__('Promotions', 'moda-interact')
			),
			createElement(
				'p',
				null,
				__(
					'Choose promotional recovery credits available to your store.',
					'moda-interact'
				)
			)
		),
		selected?.locked
			? createElement(
					'aside',
					{ className: 'moda-promotions__current', role: 'status' },
					createElement(
						'div',
						{ className: 'moda-promotions__section-head' },
						createElement(
							'span',
							{ className: 'moda-promotions__eyebrow' },
							__('Current promotion', 'moda-interact')
						),
						createElement(
							'h2',
							null,
							__('Current promotion', 'moda-interact')
						)
					),
					createElement(
						'h3',
						{ dir: 'auto' },
						selected.merchantTitle ||
							__('Unavailable', 'moda-interact')
					),
					createElement(
						'p',
						null,
						sprintf(
							/* translators: %s: remaining credits on the current promotion. */
							__('Remaining %s', 'moda-interact'),
							String(selected.remainingQuantity ?? 0)
						)
					),
					createElement(
						'p',
						null,
						sprintf(
							/* translators: %s: selected promotion expiry date. */
							__('Expires %s', 'moda-interact'),
							String(selected.expiresAt ?? '—')
						)
					)
				)
			: null,
		createElement(
			'section',
			{
				className: 'moda-promotions__panel',
				'aria-labelledby': 'moda-promotions-offers-heading',
			},
			createElement(
				'div',
				{ className: 'moda-promotions__section-head' },
				createElement(
					'span',
					{ className: 'moda-promotions__eyebrow' },
					__('Promotions', 'moda-interact')
				),
				createElement(
					'h2',
					{ id: 'moda-promotions-offers-heading' },
					__('Available promotions', 'moda-interact')
				)
			),
			offerBody,
			ready
				? createElement(PromotionPager, {
						page: pagination.page,
						totalPages: pagination.totalPages,
						onPage: onOffersPage,
					})
				: null
		),
		ready
			? createElement(PromotionHistory, {
					history: model.history,
					page: model.history?.page,
					onPage: onHistoryPage,
				})
			: createElement(
					'details',
					{ className: 'moda-promotions__history', open: true },
					createElement(
						'summary',
						null,
						createElement(
							'h2',
							null,
							__('Promotion history', 'moda-interact')
						)
					),
					createElement(
						'p',
						{ className: 'moda-promotions__empty' },
						nonReadyMessage(model.status)
					)
				)
	);
}
