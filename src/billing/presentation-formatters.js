import { __ } from '@wordpress/i18n';

export function resolveBillingLocale(locales = globalThis.modaInteractLocale) {
	const candidates = [locales?.user, locales?.site, 'en'];
	for (const candidate of candidates) {
		if (typeof candidate !== 'string' || !candidate.trim()) {
			continue;
		}
		try {
			const normalized = candidate.trim().replaceAll('_', '-');
			const [locale] = Intl.getCanonicalLocales(normalized);
			new Intl.NumberFormat(locale);
			new Intl.DateTimeFormat(locale);
			return locale;
		} catch {
			continue;
		}
	}
	return 'en';
}

export function formatMoney(
	amountMinor,
	currency,
	locale = resolveBillingLocale()
) {
	try {
		const formatter = new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
		});
		const fractionDigits =
			formatter.resolvedOptions().maximumFractionDigits;
		return formatter.format(amountMinor / 10 ** fractionDigits);
	} catch {
		return `${amountMinor} ${currency}`;
	}
}

export function formatDate(value, locale = resolveBillingLocale()) {
	if (!value) {
		return __('Not applicable', 'moda-interact');
	}
	return new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeZone: 'UTC',
	}).format(new Date(value));
}

export function formatQuantity(value, locale = resolveBillingLocale()) {
	return new Intl.NumberFormat(locale).format(value);
}
