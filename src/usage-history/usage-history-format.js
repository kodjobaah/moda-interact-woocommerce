import { resolveBillingLocale } from '../billing/presentation-formatters';

export function usageFormatters(locale = resolveBillingLocale()) {
	const formatNumber = (value) => new Intl.NumberFormat(locale).format(value);
	const formatDate = (value, withTime = false) => {
		const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
		if (!Number.isFinite(timestamp)) return '—';
		return new Intl.DateTimeFormat(locale, withTime ? {
			dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
		} : { dateStyle: 'medium', timeZone: 'UTC' }).format(timestamp);
	};
	return { formatNumber, formatDate };
}
