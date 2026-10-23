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

function formatConversationDay(instant, zone, locale) {
	if (!instant) {
		return null;
	}
	try {
		return new Intl.DateTimeFormat(locale, {
			dateStyle: 'medium',
			timeZone: zone,
		}).format(new Date(instant));
	} catch {
		return null;
	}
}

function formatConversationTime(instant, zone, locale) {
	if (!instant) {
		return null;
	}
	try {
		return new Intl.DateTimeFormat(locale, {
			timeStyle: 'short',
			timeZone: zone,
		}).format(new Date(instant));
	} catch {
		return null;
	}
}

export function formatDetailMoney(value, locale = resolveBillingLocale()) {
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

/**
 * Shopify fixture names may append a store URL using the explicit `--` marker.
 * Remove only recognised store suffixes, preserving the actual customer name.
 */
export function recoveryCustomerHeading(customer, fallback) {
	const raw = [customer?.firstName, customer?.lastName]
		.filter(Boolean)
		.join(' ');
	let store = null;
	const name = raw
		.replace(
			/--(https?:\/\/[^\s]+|[a-z0-9-]+\.myshopify\.com)(?=\s|$)/giu,
			(_match, value) => {
				store ??= value;
				return ' ';
			}
		)
		.replace(/\s+/gu, ' ')
		.trim();
	return { name: name || customer?.email || fallback, store };
}

export function detailSummaryDisplay(dto, locale = resolveBillingLocale()) {
	const heading = recoveryCustomerHeading(
		dto.customer,
		__('Guest', 'moda-interact')
	);
	const at = (value) => formatDateTime(value, dto.timeZone, locale);
	return {
		customerName: heading.name,
		customerSite: heading.store,
		customerEmail: dto.customer?.email ?? null,
		status: dto.status,
		checkoutValue: formatDetailMoney(dto.value, locale),
		startedAt: at(dto.milestones.detectedAt),
		basket: dto.basket,
		followUpUsed: dto.conversation?.followUp?.sequence2Used === true,
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
			day: formatConversationDay(item.createdAt, zone, locale),
			time: formatConversationTime(item.createdAt, zone, locale),
			deliveryStatus: deliveryLabel(item.delivery?.status),
			moderationStatus: item.moderationStatus,
			moderationReasonCode: item.moderationReasonCode,
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
		checkoutValue: formatDetailMoney(item.value, locale),
		status: item.status,
	}));
}
