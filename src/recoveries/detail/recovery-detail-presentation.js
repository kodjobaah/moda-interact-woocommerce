import { __ } from '@wordpress/i18n';
import { resolveBillingLocale } from '../../billing/presentation-formatters';

function formatDateTime(instant, zone, locale) {
	if (!instant) {
		return null;
	}
	try {
		return new Intl.DateTimeFormat(locale, {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: zone,
		}).format(new Date(instant));
	} catch {
		return null;
	}
}

function formatMoney(value, locale) {
	if (
		!value ||
		value.incomplete ||
		value.amount === null ||
		value.currency === null
	) {
		return null;
	}
	try {
		const number = Number(value.amount);
		if (
			!Number.isFinite(number) ||
			Math.abs(number) > Number.MAX_SAFE_INTEGER
		) {
			return null;
		}
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: value.currency,
		}).format(number);
	} catch {
		return null;
	}
}

function deliveryLabel(status) {
	switch (status) {
		case 'PENDING':
			return __('Pending', 'moda-interact');
		case 'SENT':
			return __('Sent', 'moda-interact');
		case 'DELIVERED':
			return __('Delivered', 'moda-interact');
		case 'READ':
			return __('Read', 'moda-interact');
		case 'FAILED':
			return __('Failed', 'moda-interact');
		default:
			return null;
	}
}

export function detailSummaryDisplay(dto, locale = resolveBillingLocale()) {
	const name = [dto.customer?.firstName, dto.customer?.lastName]
		.filter(Boolean)
		.join(' ');
	const at = (value) => formatDateTime(value, dto.timeZone, locale);
	return {
		customerName:
			name || dto.customer?.email || __('Guest', 'moda-interact'),
		customerEmail: dto.customer?.email ?? null,
		status: dto.status,
		checkoutValue: formatMoney(dto.value, locale),
		startedAt: at(dto.milestones.detectedAt),
		milestones: {
			started: at(dto.milestones.detectedAt),
			sent: at(dto.milestones.messageSentAt),
			engaged: at(dto.milestones.engagedAt),
			recovered: at(dto.milestones.completedAt),
			expired: at(dto.milestones.expiredAt),
		},
	};
}

export function detailMessagesDisplay(
	items,
	zone,
	locale = resolveBillingLocale()
) {
	return items.map((item) => {
		const sender =
			{
				CUSTOMER: 'customer',
				AGENT: 'assistant',
				AUTOMATION: 'automation',
				HUMAN: 'team',
			}[item.sender] ?? 'unknown';
		return {
			id: item.id,
			direction: item.direction === 'OUTBOUND' ? 'outbound' : 'inbound',
			sender,
			contentType: item.content.type,
			text: item.content.text,
			createdAt: formatDateTime(item.createdAt, zone, locale),
			deliveryStatus: deliveryLabel(item.delivery?.status),
			sentAt: formatDateTime(item.delivery?.sentAt, zone, locale),
			deliveredAt: formatDateTime(
				item.delivery?.deliveredAt,
				zone,
				locale
			),
			readAt: formatDateTime(item.delivery?.readAt, zone, locale),
		};
	});
}

export function detailRelatedDisplay(
	items,
	zone,
	locale = resolveBillingLocale()
) {
	return items.map((item) => ({
		id: item.id,
		label:
			formatDateTime(item.detectedAt, zone, locale) ??
			__('Unavailable', 'moda-interact'),
		checkoutValue: formatMoney(item.value, locale),
		status: item.status,
	}));
}
