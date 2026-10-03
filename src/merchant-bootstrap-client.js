import apiFetch from '@wordpress/api-fetch';

export const MERCHANT_BOOTSTRAP_PATH = '/moda-interact/v1/merchant/bootstrap';

const ERROR_CODES = new Set([
	'RECONNECT_REQUIRED',
	'SITE_URL_CHANGED',
	'REMOTE_UNAVAILABLE',
	'REMOTE_RESPONSE_INVALID',
	'MERCHANT_BOOTSTRAP_UNAVAILABLE',
	'LOCAL_STATE_INVALID',
]);

const SHOP_KEYS = [
	'id',
	'platform',
	'domain',
	'onboardingCompleted',
	'installedAt',
];
const INTERNATIONAL_CONTEXT_KEYS = [
	'storeLocale',
	'languageTag',
	'timeZone',
	'countryCode',
];
const STORE_PROFILE_KEYS = [
	'activeCategory',
	'pendingCategory',
	'pendingSelectionGeneration',
	'pendingSelectedAt',
];
const CATEGORY_KEYS = ['id', 'slug', 'displayName'];

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
	return (
		isRecord(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function isText(value, maximum) {
	return (
		typeof value === 'string' && value.length > 0 && value.length <= maximum
	);
}

function isNullableText(value, maximum) {
	return value === null || isText(value, maximum);
}

function isDateTime(value) {
	if (typeof value !== 'string') {
		return false;
	}
	const match = value.match(
		/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
	);
	if (!match || !Number.isFinite(Date.parse(value))) {
		return false;
	}
	const [, year, month, day, hour, minute, second] = match;
	const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
	return (
		Number(month) >= 1 &&
		Number(month) <= 12 &&
		Number(day) >= 1 &&
		Number(day) <= daysInMonth &&
		Number(hour) <= 23 &&
		Number(minute) <= 59 &&
		Number(second) <= 59
	);
}

function isNullableDateTime(value) {
	return value === null || isDateTime(value);
}

function isCategory(value) {
	return (
		value === null ||
		(hasExactKeys(value, CATEGORY_KEYS) &&
			isText(value.id, 128) &&
			isText(value.slug, 128) &&
			isText(value.displayName, 255))
	);
}

export function parseMerchantBootstrap(payload) {
	if (
		!hasExactKeys(payload, [
			'schemaVersion',
			'shop',
			'internationalContext',
			'storeProfile',
		]) ||
		payload.schemaVersion !== 1 ||
		!hasExactKeys(payload.shop, SHOP_KEYS) ||
		!isText(payload.shop.id, 128) ||
		payload.shop.platform !== 'WOOCOMMERCE' ||
		!isText(payload.shop.domain, 512) ||
		typeof payload.shop.onboardingCompleted !== 'boolean' ||
		!isDateTime(payload.shop.installedAt) ||
		!hasExactKeys(
			payload.internationalContext,
			INTERNATIONAL_CONTEXT_KEYS
		) ||
		!isNullableText(payload.internationalContext.storeLocale, 128) ||
		!isNullableText(payload.internationalContext.languageTag, 64) ||
		!isNullableText(payload.internationalContext.timeZone, 255) ||
		!isNullableText(payload.internationalContext.countryCode, 2) ||
		!hasExactKeys(payload.storeProfile, STORE_PROFILE_KEYS) ||
		!isCategory(payload.storeProfile.activeCategory) ||
		!isCategory(payload.storeProfile.pendingCategory) ||
		!Number.isInteger(payload.storeProfile.pendingSelectionGeneration) ||
		payload.storeProfile.pendingSelectionGeneration < 0 ||
		!isNullableDateTime(payload.storeProfile.pendingSelectedAt)
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}

	return {
		schemaVersion: 1,
		shop: { ...payload.shop },
		internationalContext: { ...payload.internationalContext },
		storeProfile: {
			...payload.storeProfile,
			activeCategory: payload.storeProfile.activeCategory
				? { ...payload.storeProfile.activeCategory }
				: null,
			pendingCategory: payload.storeProfile.pendingCategory
				? { ...payload.storeProfile.pendingCategory }
				: null,
		},
	};
}

function readErrorCode(error) {
	if (!isRecord(error)) {
		return null;
	}
	let code = null;
	if (typeof error.error === 'string') {
		code = error.error;
	} else if (typeof error.code === 'string') {
		code = error.code;
	} else if (typeof error.message === 'string') {
		code = error.message;
	}
	return ERROR_CODES.has(code) ? code : null;
}

export function createMerchantBootstrapClient(request = apiFetch) {
	return {
		async getMerchantBootstrap() {
			try {
				return parseMerchantBootstrap(
					await request({
						path: MERCHANT_BOOTSTRAP_PATH,
						method: 'GET',
					})
				);
			} catch (error) {
				const code = readErrorCode(error);
				throw new Error(code ?? 'LOAD_FAILED');
			}
		},
	};
}
