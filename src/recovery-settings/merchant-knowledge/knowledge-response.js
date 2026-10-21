// API-015/016 bounded read projection. WordPress validates the full hosted
// contract; this second check prevents rendering missing or invented state.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const LANG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const PURPOSES = new Set([
	'COMPANY_INFORMATION',
	'CUSTOMER_SUPPORT',
	'POLICIES',
	'FAQ',
	'PRODUCT_INFORMATION',
	'SHIPPING_AND_DELIVERY',
	'PRICING',
]);
const FORMATS = new Set(['WEB_PAGE', 'CSV', 'XLSX']);
const STATES = new Set(['ENABLED', 'MERCHANT_DISABLED', 'PLAN_UNENTITLED']);
const STATUS = new Set([
	'PENDING',
	'PROCESSING',
	'ACTIVE',
	'FAILED',
	'SUPERSEDED',
]);
const DORMANT = new Set([
	null,
	'NO_CURRENT_PLAN',
	'SOURCE_TYPE',
	'SOURCE_COUNT',
	'MERCHANT_DISABLED',
]);
const isRecord = (x) =>
	x !== null && typeof x === 'object' && !Array.isArray(x);
const exactly = (x, fields) =>
	isRecord(x) &&
	Object.keys(x).length === fields.length &&
	fields.every((field) => Object.hasOwn(x, field));
const uint = (x) => Number.isSafeInteger(x) && x >= 0 && x <= 25000000;
const id = (x) => typeof x === 'string' && ID.test(x);
const lang = (x) => typeof x === 'string' && LANG.test(x);
const text = (x, limit = 160) =>
	typeof x === 'string' && !!x.trim() && x.length <= limit;
const maybe = (x, check) => x === null || check(x);

function validRevision(r) {
	return (
		r === null ||
		(exactly(r, [
			'id',
			'generation',
			'reason',
			'status',
			'requestedUrl',
			'resolvedUrl',
			'contentUnits',
			'truncated',
			'fetchedAt',
			'completedAt',
			'failureCode',
			'activeContentUnits',
			'activeTruncated',
			'activeFetchedAt',
		]) &&
			id(r.id) &&
			uint(r.generation) &&
			STATUS.has(r.status) &&
			[
				'CREATE',
				'URL_CHANGE',
				'FILE_REPLACE',
				'REFRESH',
				'REPROCESS',
				'ENTITLEMENT_CHANGE',
			].includes(r.reason) &&
			maybe(r.requestedUrl, (x) => text(x, 2048)) &&
			maybe(r.resolvedUrl, (x) => text(x, 2048)) &&
			maybe(r.contentUnits, uint) &&
			typeof r.truncated === 'boolean' &&
			maybe(r.fetchedAt, (x) => text(x, 40)) &&
			maybe(r.completedAt, (x) => text(x, 40)) &&
			maybe(r.failureCode, (x) => text(x, 128)) &&
			maybe(r.activeContentUnits, uint) &&
			typeof r.activeTruncated === 'boolean' &&
			maybe(r.activeFetchedAt, (x) => text(x, 40)))
	);
}

function validSource(x) {
	return (
		exactly(x, [
			'id',
			'name',
			'purposeKey',
			'purposeDisplayName',
			'dataFormatKey',
			'dataFormatDisplayName',
			'uploadedFileName',
			'languageTag',
			'position',
			'currentGeneration',
			'currentlyPlanEntitled',
			'processingEligible',
			'dormantReason',
			'revision',
			'activeRevision',
		]) &&
		id(x.id) &&
		text(x.name) &&
		PURPOSES.has(x.purposeKey) &&
		text(x.purposeDisplayName) &&
		FORMATS.has(x.dataFormatKey) &&
		text(x.dataFormatDisplayName) &&
		maybe(x.uploadedFileName, (v) => text(v, 255)) &&
		lang(x.languageTag) &&
		uint(x.position) &&
		uint(x.currentGeneration) &&
		typeof x.currentlyPlanEntitled === 'boolean' &&
		typeof x.processingEligible === 'boolean' &&
		DORMANT.has(x.dormantReason) &&
		validRevision(x.revision) &&
		(x.activeRevision === null ||
			(exactly(x.activeRevision, [
				'id',
				'generation',
				'contentUnits',
				'truncated',
				'fetchedAt',
			]) &&
				id(x.activeRevision.id) &&
				uint(x.activeRevision.generation) &&
				maybe(x.activeRevision.contentUnits, uint) &&
				typeof x.activeRevision.truncated === 'boolean' &&
				maybe(x.activeRevision.fetchedAt, (v) => text(v, 40))))
	);
}

export function parseKnowledgePage(value) {
	if (
		!exactly(value, [
			'schemaVersion',
			'state',
			'planEntitled',
			'merchantEnabled',
			'effectiveEnabled',
			'maxKnowledgeSources',
			'maxContentUnitsPerSource',
			'maxUploadBytes',
			'configuredCount',
			'planEligibleSourceCount',
			'defaultLanguageTag',
			'supportedLanguageTags',
			'catalogue',
			'sources',
			'nextPosition',
		]) ||
		value.schemaVersion !== 1 ||
		!STATES.has(value.state) ||
		!['planEntitled', 'merchantEnabled', 'effectiveEnabled'].every(
			(key) => typeof value[key] === 'boolean'
		) ||
		value.effectiveEnabled !==
			(value.planEntitled && value.merchantEnabled) ||
		![
			'maxKnowledgeSources',
			'maxContentUnitsPerSource',
			'maxUploadBytes',
			'configuredCount',
			'planEligibleSourceCount',
		].every((key) => uint(value[key])) ||
		value.maxUploadBytes > 25 * 1024 * 1024 ||
		!lang(value.defaultLanguageTag) ||
		!Array.isArray(value.supportedLanguageTags) ||
		value.supportedLanguageTags.length > 25 ||
		!value.supportedLanguageTags.every(lang) ||
		!Array.isArray(value.catalogue) ||
		value.catalogue.length > 200 ||
		!Array.isArray(value.sources) ||
		value.sources.length > 100 ||
		!maybe(value.nextPosition, uint)
	) {
		throw new Error('KNOWLEDGE_INVALID');
	}
	for (const pair of value.catalogue) {
		if (
			!exactly(pair, ['purpose', 'dataFormat']) ||
			!exactly(pair.purpose, ['key', 'displayName']) ||
			!exactly(pair.dataFormat, [
				'key',
				'displayName',
				'inputKind',
				'canonicalExtension',
				'acceptedContentTypes',
			]) ||
			!PURPOSES.has(pair.purpose.key) ||
			!text(pair.purpose.displayName) ||
			!FORMATS.has(pair.dataFormat.key) ||
			!text(pair.dataFormat.displayName) ||
			!['REMOTE_URL', 'UPLOAD'].includes(pair.dataFormat.inputKind) ||
			!maybe(pair.dataFormat.canonicalExtension, (x) =>
				/^\.[A-Za-z0-9]{1,15}$/.test(x)
			) ||
			!Array.isArray(pair.dataFormat.acceptedContentTypes) ||
			pair.dataFormat.acceptedContentTypes.length > 20 ||
			!pair.dataFormat.acceptedContentTypes.every((x) => text(x, 128)) ||
			(pair.dataFormat.key === 'WEB_PAGE') !==
				(pair.dataFormat.inputKind === 'REMOTE_URL')
		) {
			throw new Error('KNOWLEDGE_INVALID');
		}
	}
	if (
		!value.sources.every(validSource) ||
		new Set(value.sources.map((x) => x.id)).size !== value.sources.length ||
		new Set(value.sources.map((x) => x.position)).size !==
			value.sources.length
	) {
		throw new Error('KNOWLEDGE_INVALID');
	}
	return value;
}

// These are UI affordances derived from authoritative entitlement, catalogue and
// source state, never a grant of permission. WordPress/API validate every write.
export function knowledgeUiActions(data) {
	const entitled = data.planEntitled === true;
	const room = data.configuredCount < data.maxKnowledgeSources;
	const has = (kind) =>
		data.catalogue.some((x) => x.dataFormat.inputKind === kind);
	return {
		addUrl: entitled && room && has('REMOTE_URL'),
		upload: entitled && room && has('UPLOAD'),
		editSource: entitled,
		deleteSource: entitled,
		moveSource: entitled,
		refreshSource: entitled,
		reprocessSource: entitled,
		replaceSource: entitled && has('UPLOAD'),
	};
}

export function presentKnowledge(data) {
	return { ...data, permissions: knowledgeUiActions(data) };
}
