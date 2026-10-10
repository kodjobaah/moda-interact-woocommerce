import apiFetch from '@wordpress/api-fetch';

export const BILLING_PATH = '/moda-interact/v1/billing';
export const BILLING_PLANS_PATH = '/moda-interact/v1/billing/plans';
export const BILLING_TOP_UP_PURCHASE_PATH =
	'/moda-interact/v1/billing/recovery-credit-purchases';

const ERROR_CODES = new Set([
	'RECONNECT_REQUIRED',
	'SITE_URL_CHANGED',
	'LOCAL_STATE_INVALID',
	'remote_authentication_failed',
	'remote_unavailable',
	'remote_response_invalid',
	'billing_not_initialized',
	'billing_operation_conflict',
	'billing_operation_in_progress',
	'billing_provider_outcome_unknown',
	'billing_operation_failed',
	'invalid_plan_selection',
	'top_up_purchase_pending',
	'top_up_bundle_not_found',
	'top_up_purchase_unavailable',
	'idempotency_conflict',
	'invalid_request',
]);

const CURRENT_PLAN_KEYS = [
	'merchantPricingPlanId',
	'displayName',
	'planKind',
	'recurringAmountMinor',
	'currency',
	'billingPeriod',
	'currentPeriodEnd',
	'cancelAtPeriodEnd',
	'cancellationEffectiveAt',
];
const PENDING_PLAN_KEYS = [
	'merchantPricingPlanId',
	'displayName',
	'recurringAmountMinor',
	'currency',
	'billingPeriod',
	'state',
];
const CAPACITY_KEYS = [
	'paidIncluded',
	'freeLifetime',
	'promotional',
	'purchased',
];
const PLAN_KEYS = [
	'merchantPricingPlanId',
	'displayName',
	'planKind',
	'cataloguePosition',
	'featured',
	'localizedDescription',
	'includedRecoveryCredits',
	'allowancePeriod',
	'billingPeriod',
	'recurringAmountMinor',
	'currency',
	'highlights',
];

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

function isInteger(value, minimum = 0) {
	return Number.isSafeInteger(value) && value >= minimum;
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

function isBalance(value, keys) {
	return (
		hasExactKeys(value, keys) && keys.every((key) => isInteger(value[key]))
	);
}

function isCurrentPlan(value) {
	return (
		hasExactKeys(value, CURRENT_PLAN_KEYS) &&
		isText(value.merchantPricingPlanId, 128) &&
		isText(value.displayName, 255) &&
		['FREE', 'PAID_METERED'].includes(value.planKind) &&
		isInteger(value.recurringAmountMinor) &&
		/^[A-Z]{3}$/.test(value.currency) &&
		value.billingPeriod === 'EVERY_30_DAYS' &&
		isNullableDateTime(value.currentPeriodEnd) &&
		typeof value.cancelAtPeriodEnd === 'boolean' &&
		isNullableDateTime(value.cancellationEffectiveAt)
	);
}

function isPendingPlan(value) {
	return (
		hasExactKeys(value, PENDING_PLAN_KEYS) &&
		isText(value.merchantPricingPlanId, 128) &&
		isText(value.displayName, 255) &&
		isInteger(value.recurringAmountMinor) &&
		/^[A-Z]{3}$/.test(value.currency) &&
		value.billingPeriod === 'EVERY_30_DAYS' &&
		['INITIATING', 'AWAITING_CONFIRMATION', 'OUTCOME_UNKNOWN'].includes(
			value.state
		)
	);
}

function isPaidIncluded(value) {
	return isBalance(value, [
		'granted',
		'currentAllowance',
		'committed',
		'reserved',
		'forfeited',
		'remaining',
	]);
}

function isPurchase(value) {
	return (
		hasExactKeys(value, [
			'id',
			'status',
			'merchantPricingUsageEventId',
			'label',
			'creditsGranted',
			'currentAmount',
			'reservedAmount',
			'createdAt',
			'activatedAt',
			'operationState',
		]) &&
		isText(value.id, 128) &&
		['REQUESTED', 'ACTIVE', 'COMPLETED', 'WITHDRAWN', 'REFUNDED'].includes(
			value.status
		) &&
		isText(value.merchantPricingUsageEventId, 128) &&
		isText(value.label, 120) &&
		isInteger(value.creditsGranted) &&
		isInteger(value.currentAmount) &&
		isInteger(value.reservedAmount) &&
		isDateTime(value.createdAt) &&
		isNullableDateTime(value.activatedAt) &&
		[
			'INITIATING',
			'AWAITING_CONFIRMATION',
			'OUTCOME_UNKNOWN',
			'CONFIRMED',
			'FAILED',
		].includes(value.operationState)
	);
}

function isTopUp(value) {
	return (
		hasExactKeys(value, [
			'merchantPricingUsageEventId',
			'label',
			'creditsGranted',
			'amountMinor',
			'currency',
			'purchaseEligible',
			'unavailableReason',
		]) &&
		isText(value.merchantPricingUsageEventId, 128) &&
		isText(value.label, 120) &&
		isInteger(value.creditsGranted, 1) &&
		isInteger(value.amountMinor, 1) &&
		value.currency === 'USD' &&
		typeof value.purchaseEligible === 'boolean' &&
		(value.unavailableReason === null ||
			value.unavailableReason === 'PENDING_PURCHASE')
	);
}

function isCapacity(value) {
	return (
		hasExactKeys(value, CAPACITY_KEYS) &&
		(value.paidIncluded === null || isPaidIncluded(value.paidIncluded)) &&
		isBalance(value.freeLifetime, [
			'granted',
			'committed',
			'reserved',
			'remaining',
		]) &&
		isBalance(value.promotional, [
			'granted',
			'committed',
			'reserved',
			'remaining',
		]) &&
		isBalance(value.purchased, [
			'granted',
			'committed',
			'reserved',
			'refunding',
			'available',
		])
	);
}

function isPresentation(value) {
	return (
		hasExactKeys(value, [
			'schemaVersion',
			'experienceState',
			'surfaces',
			'currentPlan',
			'pendingPlan',
			'pendingCancellation',
			'capacity',
			'topUps',
		]) &&
		value.schemaVersion === 1 &&
		['ACTIVE', 'NO_CONTRACT', 'FROZEN', 'BILLING_ATTENTION'].includes(
			value.experienceState
		) &&
		hasExactKeys(value.surfaces, [
			'usageHistoryAllowed',
			'purchaseHistoryAllowed',
			'managePlansAllowed',
			'cancelSubscriptionAllowed',
		]) &&
		Object.values(value.surfaces).every(
			(allowed) => typeof allowed === 'boolean'
		) &&
		(value.currentPlan === null || isCurrentPlan(value.currentPlan)) &&
		(value.pendingPlan === null || isPendingPlan(value.pendingPlan)) &&
		(value.pendingCancellation === null ||
			(hasExactKeys(value.pendingCancellation, ['state']) &&
				[
					'INITIATING',
					'AWAITING_CONFIRMATION',
					'OUTCOME_UNKNOWN',
					'CONFIRMED',
				].includes(value.pendingCancellation.state))) &&
		isCapacity(value.capacity) &&
		hasExactKeys(value.topUps, [
			'configured',
			'purchaseEligible',
			'offers',
			'latestPurchase',
			'unresolvedPurchases',
		]) &&
		typeof value.topUps.configured === 'boolean' &&
		typeof value.topUps.purchaseEligible === 'boolean' &&
		Array.isArray(value.topUps.offers) &&
		value.topUps.offers.every(isTopUp) &&
		(value.topUps.latestPurchase === null ||
			isPurchase(value.topUps.latestPurchase)) &&
		Array.isArray(value.topUps.unresolvedPurchases) &&
		value.topUps.unresolvedPurchases.length <= 100 &&
		value.topUps.unresolvedPurchases.every(isPurchase)
	);
}

function isPlan(value) {
	return (
		hasExactKeys(value, PLAN_KEYS) &&
		isText(value.merchantPricingPlanId, 128) &&
		isText(value.displayName, 255) &&
		['FREE', 'PAID_METERED'].includes(value.planKind) &&
		isInteger(value.cataloguePosition) &&
		typeof value.featured === 'boolean' &&
		isText(value.localizedDescription, 2000) &&
		isInteger(value.includedRecoveryCredits) &&
		['LIFETIME', 'EVERY_30_DAYS'].includes(value.allowancePeriod) &&
		value.billingPeriod === 'EVERY_30_DAYS' &&
		isInteger(value.recurringAmountMinor) &&
		typeof value.currency === 'string' &&
		/^[A-Z]{3}$/.test(value.currency) &&
		Array.isArray(value.highlights) &&
		value.highlights.every(
			(highlight) =>
				hasExactKeys(highlight, [
					'contentKey',
					'position',
					'title',
					'description',
				]) &&
				isText(highlight.contentKey, 128) &&
				isInteger(highlight.position) &&
				isText(highlight.title, 120) &&
				isText(highlight.description, 2000)
		)
	);
}

export function parseBillingPresentation(payload) {
	if (!isPresentation(payload)) {
		throw new Error('remote_response_invalid');
	}
	return payload;
}

export function parseBillingPlans(payload) {
	if (
		!hasExactKeys(payload, ['schemaVersion', 'resolvedLocale', 'plans']) ||
		payload.schemaVersion !== 1 ||
		!isText(payload.resolvedLocale, 64) ||
		!Array.isArray(payload.plans) ||
		!payload.plans.every(isPlan)
	) {
		throw new Error('remote_response_invalid');
	}
	return payload;
}

export function isWooConfirmationUrl(value) {
	if (typeof value !== 'string' || value.length > 2048) {
		return false;
	}
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			['woocommerce.com', 'sandbox.woocommerce.com'].includes(
				url.hostname.toLowerCase()
			) &&
			url.username === '' &&
			url.password === '' &&
			url.hash === ''
		);
	} catch {
		return false;
	}
}

function parseCommand(payload, cancellation = false) {
	const valid =
		hasExactKeys(payload, [
			'schemaVersion',
			'operationId',
			'state',
			'confirmationUrl',
		]) &&
		payload.schemaVersion === 1 &&
		isText(payload.operationId, 128) &&
		(cancellation
			? payload.state === 'CONFIRMED' && payload.confirmationUrl === null
			: ['AWAITING_CONFIRMATION', 'CONFIRMED'].includes(payload.state) &&
				isWooConfirmationUrl(payload.confirmationUrl));
	if (!valid) {
		throw new Error('remote_response_invalid');
	}
	return payload;
}

function parseTopUpPurchaseCommand(payload) {
	if (
		!hasExactKeys(payload, [
			'schemaVersion',
			'purchaseId',
			'operationId',
			'state',
			'confirmationUrl',
		]) ||
		payload.schemaVersion !== 1 ||
		!isText(payload.purchaseId, 128) ||
		!payload.purchaseId.trim() ||
		!isText(payload.operationId, 128) ||
		!payload.operationId.trim() ||
		payload.state !== 'AWAITING_CONFIRMATION' ||
		!isWooConfirmationUrl(payload.confirmationUrl)
	) {
		throw new Error('remote_response_invalid');
	}
	return payload;
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

function withBoundedErrors(operation) {
	return operation.catch((error) => {
		throw new Error(readErrorCode(error) ?? 'remote_unavailable');
	});
}

export function createBillingClient(request = apiFetch) {
	return {
		getBilling() {
			return withBoundedErrors(
				request({ path: BILLING_PATH, method: 'GET' }).then(
					parseBillingPresentation
				)
			);
		},
		getPlans() {
			return withBoundedErrors(
				request({ path: BILLING_PLANS_PATH, method: 'GET' }).then(
					parseBillingPlans
				)
			);
		},
		createSubscription(merchantPricingPlanId, actionId) {
			return this.command(
				'/subscription',
				{ merchantPricingPlanId, actionId },
				false
			);
		},
		switchSubscription(merchantPricingPlanId, actionId) {
			return this.command(
				'/subscription/switch',
				{ merchantPricingPlanId, actionId },
				false
			);
		},
		cancelSubscription(actionId) {
			return this.command('/subscription/cancel', { actionId }, true);
		},
		purchaseRecoveryCredits(merchantPricingUsageEventId, actionId) {
			return withBoundedErrors(
				request({
					path: BILLING_TOP_UP_PURCHASE_PATH,
					method: 'POST',
					data: { merchantPricingUsageEventId, actionId },
				}).then(parseTopUpPurchaseCommand)
			);
		},
		command(suffix, data, cancellation) {
			return withBoundedErrors(
				request({
					path: `${BILLING_PATH}${suffix}`,
					method: 'POST',
					data,
				}).then((payload) => parseCommand(payload, cancellation))
			);
		},
	};
}
