import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { PromotionCards, PromotionPager } from './presentation';
import { PromotionHistory } from './history';
import { formatDate, formatQuantity } from '../billing/presentation-formatters';

function nonReadyMessage(status) {
	if (status === 'LOADING' || status === 'IDLE') {
		return __('Loading…', 'moda-interact');
	}
	if (status === 'DENIED') {
		return __('You do not have permission to view promotions.', 'moda-interact');
	}
	if (status === 'RECONNECT_REQUIRED') {
		return __('Reconnect Moda Interact to view promotions.', 'moda-interact');
	}
	if (status === 'CONFLICT') {
		return __('Promotions changed. Refresh to see the latest offers.', 'moda-interact');
	}
	if (status === 'ERROR') {
		return __('This section could not be loaded.', 'moda-interact');
	}
	return __(
		'Promotion offers are not yet available for WooCommerce.',
		'moda-interact'
	);
}

function noticeMessage(code) {
	if (code === 'CONFLICT') {
		return __('Promotions changed. The latest offers have been loaded.', 'moda-interact');
	}
	if (code === 'PROMOTION_INELIGIBLE') {
		return __('Promotion is no longer eligible. The latest offers have been loaded.', 'moda-interact');
	}
	return null;
}

/**
 * Render only validated, authoritative API-021 state from the connected controller.
 * Promotional recovery credits are not WooCommerce coupons or purchased credits.
 *
 * @param {Object}                              root0               Component properties.
 * @param {Object}                              root0.model         Authoritative state.
 * @param {((campaignId: string) => void)|null} root0.onSelect      Selection callback.
 * @param {((page: number) => void)|null}       root0.onOffersPage  Offer paging callback.
 * @param {((page: number) => void)|null}       root0.onHistoryPage History paging callback.
 * @param {(() => void)|null}                 root0.onRefresh     Reload from API.
 * @param {(() => void)|null}                 root0.onReconnect   Revalidate installation.
 * @return {Object} Promotions screen.
 */
export function PromotionsScreen({
	model = { status: 'UNAVAILABLE' },
	onSelect = null,
	onOffersPage = null,
	onHistoryPage = null,
	onRefresh = null,
	onReconnect = null,
}) {
	const ready = model.status === 'READY';
	const selected = ready ? model.selection : null;
	const offers = ready ? (model.offers ?? []) : [];
	const otherOffers = offers.filter((offer) => offer.id !== selected?.campaignId);
	const pagination = ready ? (model.offersPagination ?? {}) : {};
	const notice = ready ? noticeMessage(model.error) : null;
	let offerBody;
	if (!ready) {
		offerBody = createElement(
			'p',
			{
				role: ['ERROR', 'DENIED', 'RECONNECT_REQUIRED', 'CONFLICT'].includes(model.status)
					? 'alert'
					: 'status',
				className: 'moda-promotions__empty',
			},
			nonReadyMessage(model.status)
		);
	} else if (otherOffers.length === 0) {
		offerBody = createElement(
			'p',
			{ role: 'status', className: 'moda-promotions__empty' },
			__('No promotions available.', 'moda-interact')
		);
	} else {
		offerBody = createElement(PromotionCards, {
			offers: otherOffers,
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
		selected
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
							formatQuantity(selected.remainingQuantity ?? 0)
						)
					),
					createElement(
						'p',
						null,
						sprintf(
							/* translators: %s: selected promotion expiry date. */
							__('Expires %s', 'moda-interact'),
							selected.expiresAt ? formatDate(selected.expiresAt) : '—'
						)
					)
				)
			: null,
		notice
			? createElement('p', { role: 'alert', className: 'moda-promotions__notice' }, notice)
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
			!ready && (onRefresh || (model.status === 'RECONNECT_REQUIRED' && onReconnect))
				? createElement('button', {
					type: 'button',
					className: 'button',
					onClick: model.status === 'RECONNECT_REQUIRED' ? onReconnect : onRefresh,
				}, model.status === 'RECONNECT_REQUIRED'
					? __('Reconnect Moda Interact', 'moda-interact')
					: __('Refresh', 'moda-interact'))
				: null,
			ready && onRefresh
				? createElement('button', {
					type: 'button', className: 'button',
					disabled: model.saving === true,
					onClick: onRefresh,
				}, __('Refresh', 'moda-interact'))
				: null,
			ready
				? createElement(PromotionPager, {
						page: pagination.page,
						totalPages: pagination.totalPages,
						onPage: model.saving ? null : onOffersPage,
					})
				: null
		),
		ready
			? createElement(PromotionHistory, {
					history: model.history,
					page: model.history?.page,
					onPage: model.saving ? null : onHistoryPage,
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
