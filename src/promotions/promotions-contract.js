/** Browser-side defence in depth for the exact API-021 Promotions DTO. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const REVISION = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HISTORY_STATUSES = [
	'SELECTED',
	'USED',
	'EXHAUSTED',
	'EXPIRED',
	'CLOSED',
	'NO_LONGER_ELIGIBLE',
	'REOPENED',
];
const object = (value) =>
	value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) =>
	object(value) &&
	Object.keys(value).length === fields.length &&
	fields.every((field) => Object.hasOwn(value, field));
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const date = (value) =>
	typeof value === 'string' && ISO.test(value) &&
	!Number.isNaN(Date.parse(value));
const string = (value, limit, required = false) =>
	typeof value === 'string' && value.length <= limit &&
	(!required || value.length > 0);
const bool = (value) => typeof value === 'boolean';

export const validCampaignId = (value) =>
	typeof value === 'string' && ID.test(value);
export const validRevision = (value) =>
	typeof value === 'string' && REVISION.test(value);
export const validPromotionPage = (value) =>
	Number.isSafeInteger(value) && value >= 1 && value <= 1000;

function pagination(value) {
	return (
		exact(value, ['page', 'pageSize', 'totalEntries', 'totalPages']) &&
		validPromotionPage(value.page) &&
		value.pageSize === 6 &&
		count(value.totalEntries) &&
		count(value.totalPages) &&
		value.totalPages === Math.max(1, Math.ceil(value.totalEntries / 6)) &&
		value.page <= value.totalPages
	);
}

function offer(value) {
	return (
		exact(value, [
			'id', 'merchantTitle', 'merchantDescription', 'quantity',
			'expiresAt', 'remainingQuantity', 'exhausted', 'previouslyClaimed',
			'currentlySelected', 'eligible', 'selectable',
		]) &&
		validCampaignId(value.id) && string(value.merchantTitle, 255, true) &&
		string(value.merchantDescription, 10000) && count(value.quantity) &&
		count(value.remainingQuantity) && value.remainingQuantity <= value.quantity &&
		date(value.expiresAt) && [
			'exhausted', 'previouslyClaimed', 'currentlySelected', 'eligible', 'selectable',
		].every((key) => bool(value[key]))
	);
}

function selection(value) {
	return (
		exact(value, [
			'campaignId', 'merchantTitle', 'remainingQuantity', 'quantityGranted',
			'reservedQuantity', 'committedQuantity', 'expiresAt', 'locked',
			'exhausted', 'campaignStatus', 'targetEligible', 'spendable',
		]) &&
		validCampaignId(value.campaignId) && string(value.merchantTitle, 255, true) &&
		['remainingQuantity', 'quantityGranted', 'reservedQuantity', 'committedQuantity']
			.every((key) => count(value[key])) &&
		value.remainingQuantity + value.reservedQuantity + value.committedQuantity ===
			value.quantityGranted &&
		date(value.expiresAt) &&
		['locked', 'exhausted', 'targetEligible', 'spendable']
			.every((key) => bool(value[key])) &&
		['DRAFT', 'ACTIVE', 'CLOSED'].includes(value.campaignStatus)
	);
}

function historyEntry(value) {
	return (
		exact(value, [
			'campaignId', 'campaignTitle', 'status', 'quantityGranted',
			'committedQuantity', 'remainingQuantity', 'lastSelectedAt', 'expiresAt',
		]) &&
		validCampaignId(value.campaignId) && string(value.campaignTitle, 255, true) &&
		HISTORY_STATUSES.includes(value.status) &&
		['quantityGranted', 'committedQuantity', 'remainingQuantity']
			.every((key) => count(value[key])) &&
		value.committedQuantity + value.remainingQuantity <= value.quantityGranted &&
		(value.lastSelectedAt === null || date(value.lastSelectedAt)) &&
		date(value.expiresAt)
	);
}

export function parsePromotionsResponse(value) {
	const history = value?.history;
	if (
		!exact(value, ['schemaVersion', 'revision', 'offers', 'offersPagination', 'selection', 'history']) ||
		value.schemaVersion !== 1 || !validRevision(value.revision) ||
		!Array.isArray(value.offers) || value.offers.length > 6 ||
		!value.offers.every(offer) || !pagination(value.offersPagination) ||
		!(value.selection === null || selection(value.selection)) ||
		!exact(history, ['page', 'pageSize', 'totalEntries', 'totalPages', 'entries']) ||
		!pagination({
			page: history.page, pageSize: history.pageSize,
			totalEntries: history.totalEntries, totalPages: history.totalPages,
		}) ||
		!Array.isArray(history.entries) || history.entries.length > 6 ||
		!history.entries.every(historyEntry) ||
		new Set(value.offers.map((item) => item.id)).size !== value.offers.length ||
		new Set(history.entries.map((item) => item.campaignId)).size !== history.entries.length
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return value;
}

export function parsePromotionSelection(value, campaignId) {
	if (
		!exact(value, ['schemaVersion', 'revision', 'selection']) ||
		value.schemaVersion !== 1 || !validRevision(value.revision) ||
		!selection(value.selection) || value.selection.campaignId !== campaignId
	) {
		throw new Error('REMOTE_RESPONSE_INVALID');
	}
	return value;
}
