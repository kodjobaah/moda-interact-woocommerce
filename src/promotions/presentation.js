import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

const display = (value) =>
	value === null || value === undefined ? '—' : String(value);

function offerStatus(offer, isCurrent) {
	if (isCurrent) {
		return __('Current promotion', 'moda-interact');
	}
	if (offer.exhausted) {
		return __('Exhausted', 'moda-interact');
	}
	if (offer.previouslyClaimed) {
		return __('Previously claimed', 'moda-interact');
	}
	return __('Available now', 'moda-interact');
}

/**
 * Offer cards never select anything without an explicit authorised callback.
 *
 * @param {Object}                              root0          Component properties.
 * @param {Array<Object>}                       root0.offers   Authoritative campaign list.
 * @param {Object|null}                         root0.selected Current selection.
 * @param {boolean}                             root0.locked   Whether selection is locked.
 * @param {boolean}                             root0.busy     Whether a submission is running.
 * @param {((campaignId: string) => void)|null} root0.onSelect Authorised selection callback.
 * @return {Object} Campaign card grid.
 */
export function PromotionCards({
	offers = [],
	selected = null,
	locked = false,
	busy = false,
	onSelect = null,
}) {
	let submitLock = false;
	return createElement(
		'div',
		{ className: 'moda-promotions__grid' },
		...offers.map((offer) => {
			const isCurrent =
				selected?.campaignId === offer.id ||
				offer.currentlySelected === true;
			const canSelect =
				!isCurrent &&
				!locked &&
				!busy &&
				!offer.exhausted &&
				typeof onSelect === 'function';
			return createElement(
				'article',
				{ className: 'moda-promotions__card', key: offer.id },
				createElement(
					'div',
					{ className: 'moda-promotions__card-top' },
					createElement(
						'span',
						{ className: 'moda-promotions__status' },
						offerStatus(offer, isCurrent)
					),
					createElement(
						'strong',
						{ className: 'moda-promotions__credit' },
						sprintf(
							/* translators: %s: promotional recovery-credit quantity. */
							__('%s credits', 'moda-interact'),
							display(offer.quantity)
						)
					)
				),
				createElement(
					'h3',
					{ dir: 'auto' },
					display(offer.merchantTitle)
				),
				createElement(
					'p',
					{ className: 'moda-promotions__description', dir: 'auto' },
					display(offer.merchantDescription)
				),
				createElement(
					'p',
					{ className: 'moda-promotions__meta' },
					sprintf(
						/* translators: %s: promotion expiry date supplied by merchant API. */
						__('Expires %s', 'moda-interact'),
						display(offer.expiresAt)
					)
				),
				createElement(
					'button',
					{
						type: 'button',
						className: 'button moda-promotions__select',
						disabled: !canSelect,
						'aria-busy': busy,
						title: !onSelect
							? __(
									'This section is not yet available for WooCommerce.',
									'moda-interact'
								)
							: undefined,
						onClick: () => {
							if (!canSelect || submitLock) {
								return;
							}
							submitLock = true;
							onSelect(offer.id);
						},
					},
					isCurrent
						? __('Current promotion', 'moda-interact')
						: __('Select promotion', 'moda-interact')
				)
			);
		})
	);
}

/**
 * @param {Object}                        root0            Pagination properties.
 * @param {number}                        root0.page       Current page.
 * @param {number}                        root0.totalPages Number of pages.
 * @param {((page: number) => void)|null} root0.onPage     Authorised page callback.
 * @return {Object|null} Pagination navigation.
 */
export function PromotionPager({ page = 1, totalPages = 1, onPage = null }) {
	if (totalPages <= 1) {
		return null;
	}
	return createElement(
		'nav',
		{
			className: 'moda-promotions__pager',
			'aria-label': __('Promotions', 'moda-interact'),
		},
		createElement(
			'button',
			{
				type: 'button',
				className: 'button',
				disabled: !onPage || page <= 1,
				onClick: () => onPage(page - 1),
			},
			__('Previous', 'moda-interact')
		),
		createElement(
			'span',
			null,
			sprintf(
				/* translators: 1: current page; 2: total pages. */
				__('Page %1$s of %2$s', 'moda-interact'),
				String(page),
				String(totalPages)
			)
		),
		createElement(
			'button',
			{
				type: 'button',
				className: 'button',
				disabled: !onPage || page >= totalPages,
				onClick: () => onPage(page + 1),
			},
			__('Next', 'moda-interact')
		)
	);
}
