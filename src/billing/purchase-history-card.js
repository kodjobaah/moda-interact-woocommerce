import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { PurchaseRefundGuidance } from './purchase-history-guidance';
import { formatDate, formatQuantity } from './presentation-formatters';

const PURCHASE_LABELS = {
	REQUESTED: __('Awaiting confirmation', 'moda-interact'),
	ACTIVE: __('Active', 'moda-interact'),
	WITHDRAWN: __('Refund pending', 'moda-interact'),
	COMPLETED: __('Completed', 'moda-interact'),
	REFUNDED: __('Refunded', 'moda-interact'),
};
const REFUND_LABELS = {
	REQUESTED: __('Refund request being prepared', 'moda-interact'),
	PROVIDER_ACTION_REQUIRED: __(
		'Awaiting vendor decision in WooCommerce',
		'moda-interact'
	),
	COMPLETED: __('Refund completed', 'moda-interact'),
	REJECTED: __('Refund rejected', 'moda-interact'),
	CANCELLED: __('Refund cancelled', 'moda-interact'),
	NEEDS_ATTENTION: __('Refund needs review', 'moda-interact'),
};

const FIELDS = [
	['creditsGranted', __('Original credits', 'moda-interact')],
	['currentAmount', __('Current credits', 'moda-interact')],
	['reservedAmount', __('Reserved / in progress', 'moda-interact')],
	['availableAmount', __('Available now', 'moda-interact')],
	['heldForRefundAmount', __('Credits held for refund', 'moda-interact')],
];

/**
 * Display only. Prices and refundable quantities are never calculated in-browser.
 * @param {Object|null} money  - Provider supplied original amount and currency.
 * @param {string}      locale - Administrator locale.
 */
function formatProviderAmount(money, locale) {
	if (!money) {
		return __('Not available', 'moda-interact');
	}
	const n = Number(money.amount);
	if (Number.isSafeInteger(Math.trunc(n)) && Number.isFinite(n)) {
		try {
			return new Intl.NumberFormat(locale, {
				style: 'currency',
				currency: money.currency,
				maximumFractionDigits: 6,
			}).format(n);
		} catch {
			// The safe original is available below.
		}
	}
	return `${money.amount} ${money.currency}`;
}

export function PurchaseHistoryCard({ purchase, data, locale }) {
	const dl = [
		[
			__('Purchase date', 'moda-interact'),
			formatDate(purchase.activatedAt ?? purchase.createdAt, locale),
		],
		...FIELDS.map(([field, label]) => [
			label,
			formatQuantity(purchase[field], locale),
		]),
		[
			__('Original purchase amount', 'moda-interact'),
			formatProviderAmount(purchase.originalProviderPurchase, locale),
		],
	];
	return createElement(
		'article',
		{ className: 'moda-purchase-history__card' },
		createElement(
			'header',
			{ className: 'moda-purchase-history__card-head' },
			createElement(
				'div',
				null,
				createElement(
					'h3',
					null,
					purchase.bundleLabel ?? __('Purchase', 'moda-interact')
				),
				createElement('p', null, purchase.planName)
			),
			createElement(
				'span',
				{ className: 'moda-purchase-history__status' },
				PURCHASE_LABELS[purchase.status]
			)
		),
		createElement(
			'dl',
			{ className: 'moda-purchase-history__details' },
			...dl.flatMap(([label, value], index) => [
				createElement('dt', { key: `d${index}` }, label),
				createElement('dd', { key: `v${index}` }, value),
			])
		),
		purchase.latestRefund
			? createElement(
					'p',
					{
						className: 'moda-purchase-history__refund-status',
						role: 'status',
					},
					REFUND_LABELS[purchase.latestRefund.status]
				)
			: null,
		createElement(PurchaseRefundGuidance, { purchase, data })
	);
}
