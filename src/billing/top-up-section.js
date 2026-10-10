import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { formatMoney, formatQuantity } from './presentation-formatters';

/** @typedef {{ merchantPricingUsageEventId: string, label: string, creditsGranted: number, amountMinor: number, currency: string, purchaseEligible: boolean, unavailableReason: string | null }} TopUpOffer */
/** @typedef {{ merchantPricingUsageEventId: string, operationState: 'INITIATING' | 'AWAITING_CONFIRMATION' | 'OUTCOME_UNKNOWN' | 'CONFIRMED' }} UnresolvedPurchase */
/** @typedef {{ configured: boolean, purchaseEligible: boolean, offers: TopUpOffer[], unresolvedPurchases: UnresolvedPurchase[] }} TopUps */
/** @typedef {{ status: string, command: string | null, feedbackContext?: string | null, notice?: string | null, error?: string | null, blockedTopUpEventId?: string | null }} BillingState */

/** @type {Record<string, string>} */
const PURCHASE_STATUS = {
	INITIATING: __('Starting purchase', 'moda-interact'),
	AWAITING_CONFIRMATION: __('Waiting for Woo confirmation', 'moda-interact'),
	OUTCOME_UNKNOWN: __(
		'Confirmation needs reconciliation. Do not retry this bundle yet.',
		'moda-interact'
	),
	CONFIRMED: __(
		'Payment confirmed. Credits are being activated.',
		'moda-interact'
	),
};

/** @type {Record<string, string>} */
const NOTICE_COPY = {
	top_up_purchase_pending: __(
		'This bundle already has a pending purchase. Refresh the billing summary before trying again.',
		'moda-interact'
	),
	billing_provider_outcome_unknown: __(
		'Confirmation needs reconciliation. Do not retry this bundle yet.',
		'moda-interact'
	),
	billing_operation_in_progress: __(
		'A billing change is already in progress. Refresh the billing summary before trying again.',
		'moda-interact'
	),
	billing_operation_failed: __(
		'The purchase could not be started.',
		'moda-interact'
	),
	top_up_bundle_not_found: __(
		'This bundle is no longer available.',
		'moda-interact'
	),
	top_up_purchase_unavailable: __('Unavailable', 'moda-interact'),
	idempotency_conflict: __(
		'This purchase attempt could not be verified. Refresh the billing summary before trying again.',
		'moda-interact'
	),
};

/**
 * @param {TopUpOffer}                     offer
 * @param {UnresolvedPurchase | undefined} unresolved
 * @param {TopUps}                         topUps
 * @param {BillingState}                   state
 */
function offerStatus(offer, unresolved, topUps, state) {
	if (unresolved) {
		return (
			PURCHASE_STATUS[unresolved.operationState] ??
			__('Purchase pending', 'moda-interact')
		);
	}
	if (state.blockedTopUpEventId === offer.merchantPricingUsageEventId) {
		return (
			NOTICE_COPY[state.notice ?? ''] ??
			__('Purchase pending', 'moda-interact')
		);
	}
	if (offer.unavailableReason === 'PENDING_PURCHASE') {
		return __('Purchase pending', 'moda-interact');
	}
	if (!topUps.purchaseEligible) {
		return __('Unavailable', 'moda-interact');
	}
	if (!offer.purchaseEligible) {
		return __('Unavailable', 'moda-interact');
	}
	return null;
}

/**
 * @param {{ data: { topUps: TopUps }, state: BillingState, onPurchase: (usageEventId: string) => unknown, locale: string }} props
 */
export function TopUpSection({ data, state, onPurchase, locale }) {
	const topUps = data.topUps;
	if (!topUps.configured || topUps.offers.length === 0) {
		return null;
	}
	const notice =
		state.feedbackContext === 'TOP_UP'
			? (NOTICE_COPY[state.notice ?? ''] ??
				NOTICE_COPY[state.error ?? ''])
			: undefined;
	return createElement(
		'section',
		{
			className: 'moda-interact-top-ups',
			'aria-labelledby': 'moda-interact-top-ups-heading',
			'aria-busy': state.command === 'SUBMITTING',
		},
		createElement(
			'header',
			{ className: 'moda-interact-top-ups__heading' },
			createElement(
				'div',
				null,
				createElement(
					'p',
					{ className: 'moda-interact-top-ups__eyebrow' },
					__('Recovery capacity', 'moda-interact')
				),
				createElement(
					'h3',
					{ id: 'moda-interact-top-ups-heading' },
					__('Predefined credit bundles', 'moda-interact')
				),
				createElement(
					'p',
					{ className: 'moda-interact-top-ups__description' },
					__(
						'Choose one bundle. WooCommerce will show the final charge and any applicable tax for confirmation.',
						'moda-interact'
					)
				)
			)
		),
		notice
			? createElement(
					'p',
					{
						className: 'moda-interact-top-ups__notice',
						role: 'alert',
					},
					notice
				)
			: null,
		createElement(
			'div',
			{ className: 'moda-interact-top-ups__grid' },
			...topUps.offers.map((offer) => {
				const unresolved = topUps.unresolvedPurchases.find(
					(purchase) =>
						purchase.merchantPricingUsageEventId ===
						offer.merchantPricingUsageEventId
				);
				const status = offerStatus(offer, unresolved, topUps, state);
				const pending = Boolean(
					unresolved || offer.unavailableReason === 'PENDING_PURCHASE'
				);
				const disabled = Boolean(
					status || state.command !== null || state.status !== 'READY'
				);
				return createElement(
					'article',
					{
						className: `moda-interact-top-up${
							status ? ' moda-interact-top-up--unavailable' : ''
						}`,
						key: offer.merchantPricingUsageEventId,
					},
					createElement('h4', null, offer.label),
					createElement(
						'p',
						{ className: 'moda-interact-top-up__price' },
						formatMoney(offer.amountMinor, offer.currency, locale)
					),
					pending
						? createElement(
								'p',
								{
									className: 'moda-interact-top-up__status',
									role: 'status',
								},
								status
							)
						: createElement(
								'div',
								{ className: 'moda-interact-top-up__actions' },
								status
									? createElement(
											'p',
											{
												className:
													'moda-interact-top-up__status',
												role: 'status',
											},
											status
										)
									: null,
								createElement(
									'button',
									{
										type: 'button',
										className: 'button button-primary',
										disabled,
										'aria-busy':
											state.command === 'SUBMITTING',
										onClick: () =>
											onPurchase(
												offer.merchantPricingUsageEventId
											),
									},
									state.command === 'SUBMITTING'
										? __('Submitting…', 'moda-interact')
										: sprintf(
												/* translators: %s: recovery-credit quantity. */
												__(
													'Buy %s credits',
													'moda-interact'
												),
												formatQuantity(
													offer.creditsGranted,
													locale
												)
											)
								)
							)
				);
			})
		)
	);
}
