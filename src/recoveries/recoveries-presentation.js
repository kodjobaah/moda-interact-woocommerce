import { __, sprintf } from '@wordpress/i18n';
import { resolveBillingLocale } from '../billing/presentation-formatters';

/**
 * Format only approved public DTO fields using the merchant admin locale.
 * @param {Object} data
 * @param {string} locale
 */
export function recoveryDisplayRows(data, locale = resolveBillingLocale()) {
	return data.items.map((item) => {
		let checkoutValue = __('Unavailable', 'moda-interact');
		if (item.totalPrice !== null && item.currency !== null) {
			try {
				const numeric = Number(item.totalPrice);
				if (
					Number.isFinite(numeric) &&
					Math.abs(numeric) <= Number.MAX_SAFE_INTEGER
				) {
					checkoutValue = new Intl.NumberFormat(locale, {
						style: 'currency',
						currency: item.currency,
					}).format(numeric);
				}
			} catch {
				// Unknown currency/overflow never fabricates a money value.
			}
		}
		let startedAt = __('Unavailable', 'moda-interact');
		try {
			startedAt = new Intl.DateTimeFormat(locale, {
				dateStyle: 'medium',
				timeStyle: 'short',
				timeZone: data.timeZone,
			}).format(new Date(item.detectedAt));
		} catch {
			// Unknown timezone fails to a localized unavailable marker.
		}
		return {
			id: item.id,
			customerName: item.customer?.displayName ?? null,
			customerEmail: item.customer?.email ?? null,
			checkoutDate: startedAt,
			status: item.status,
			checkoutValue,
			startedAt,
		};
	});
}

export function recoveryRangeLabel(data, locale = resolveBillingLocale()) {
	try {
		const format = new Intl.DateTimeFormat(locale, {
			dateStyle: 'medium',
			timeZone: 'UTC',
		});
		return `${format.format(new Date(`${data.from}T12:00:00Z`))} – ${format.format(new Date(`${data.to}T12:00:00Z`))}`;
	} catch {
		return '';
	}
}

export function recoveryPaginationLabel(data, locale = resolveBillingLocale()) {
	/* translators: 1: current page; 2: total number of pages. */
	const template = __('Page %1$s of %2$s', 'moda-interact');
	return sprintf(
		template,
		new Intl.NumberFormat(locale).format(data.page),
		new Intl.NumberFormat(locale).format(data.totalPages)
	);
}
