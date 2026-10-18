import { __ } from '@wordpress/i18n';

// The hosted read projection is the only source of counts and catalogue choices.
export function sourceCapacity(data) {
	return {
		configured: data?.configuredCount,
		limit: data?.maxKnowledgeSources,
		eligible: data?.planEligibleSourceCount,
	};
}

export function sourceCapacityAvailable(data) {
	const { limit, configured } = sourceCapacity(data);
	return (
		Number.isSafeInteger(limit) &&
		limit > 0 &&
		Number.isSafeInteger(configured) &&
		configured >= 0 &&
		configured < limit
	);
}

export function catalogueFor(data, kind) {
	return (data?.catalogue ?? []).filter(
		(item) =>
			item?.purpose?.key &&
			item?.dataFormat?.key &&
			item.dataFormat.inputKind === kind
	);
}

// Localised UI labels are keyed by the approved catalogue identifiers. Display
// names from the server are only fallbacks for future, unrecognised entries.
export function purposeLabel(key, fallback = key) {
	switch (key) {
		case 'COMPANY_INFORMATION':
			return __('Company information', 'moda-interact');
		case 'CUSTOMER_SUPPORT':
			return __('Customer support', 'moda-interact');
		case 'POLICIES':
			return __('Policies', 'moda-interact');
		case 'FAQ':
			return __('Frequently asked questions', 'moda-interact');
		case 'PRODUCT_INFORMATION':
			return __('Product information', 'moda-interact');
		case 'SHIPPING_AND_DELIVERY':
			return __('Shipping and delivery', 'moda-interact');
		case 'PRICING':
			return __('Pricing', 'moda-interact');
		default:
			return fallback;
	}
}

export function formatLabel(key, fallback = key) {
	switch (key) {
		case 'WEB_PAGE':
			return __('Web page', 'moda-interact');
		case 'CSV':
			return __('CSV spreadsheet', 'moda-interact');
		case 'XLSX':
			return __('Excel spreadsheet (.xlsx)', 'moda-interact');
		default:
			return fallback;
	}
}

export function sourceStatus(source) {
	switch (source.dormantReason) {
		case 'MERCHANT_DISABLED':
			return {
				label: __('Configured — processing paused', 'moda-interact'),
				tone: 'paused',
			};
		case 'NO_CURRENT_PLAN':
			return {
				label: __('Configured — unavailable on current plan', 'moda-interact'),
				tone: 'inactive',
			};
		case 'SOURCE_TYPE':
			return {
				label: __('Configured — source type unavailable', 'moda-interact'),
				tone: 'inactive',
			};
		case 'SOURCE_COUNT':
			return {
				label: __('Configured — over current source limit', 'moda-interact'),
				tone: 'inactive',
			};
		default:
			break;
	}
	switch (source.revision?.status) {
		case 'ACTIVE':
			return { label: __('Ready', 'moda-interact'), tone: 'ready' };
		case 'FAILED':
			return { label: __('Failed', 'moda-interact'), tone: 'failed' };
		case 'SUPERSEDED':
			return { label: __('Superseded', 'moda-interact'), tone: 'inactive' };
		case 'PENDING':
		case 'PROCESSING':
			return { label: __('Processing', 'moda-interact'), tone: 'processing' };
		default:
			return { label: __('Unavailable', 'moda-interact'), tone: 'inactive' };
	}
}
