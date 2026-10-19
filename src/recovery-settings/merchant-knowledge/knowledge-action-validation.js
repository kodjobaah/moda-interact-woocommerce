import { validKnowledgeFile, validKnowledgeUrl } from './knowledge-client';
import { sourceCapacityAvailable } from './knowledge-display';

export function knowledgeActionAllowed(data, client, action, payload) {
	if (
		['addUrl', 'upload'].includes(action) &&
		(!data.planEntitled || !sourceCapacityAvailable(data))
	) {
		return false;
	}
	if (!data?.permissions?.[action] || typeof client[action] !== 'function') {
		return false;
	}
	if (
		action === 'addUrl' &&
		(!payload?.name?.trim() ||
			!validKnowledgeUrl(payload.url ?? '') ||
			!payload.purpose ||
			!payload.languageTag)
	) {
		return false;
	}
	if (
		action === 'upload' &&
		(!payload?.name?.trim() ||
			!payload.purpose ||
			!payload.languageTag ||
			!validKnowledgeFile(
				payload.file,
				data.maxUploadBytes,
				payload.dataFormatKey
			) ||
			!['CSV', 'XLSX'].includes(payload.dataFormatKey))
	) {
		return false;
	}
	const sourceActions = [
		'refreshSource',
		'deleteSource',
		'moveSource',
		'editSource',
		'replaceSource',
		'reprocessSource',
	];
	if (
		sourceActions.includes(action) &&
		!data.sources?.some((source) => source.id === payload?.id)
	) {
		return false;
	}
	const source = data.sources?.find((item) => item.id === payload?.id);
	if (
		action === 'addUrl' &&
		!data.catalogue?.some(
			(item) =>
				item.purpose.key === payload.purpose &&
				item.dataFormat.key === 'WEB_PAGE'
		)
	) {
		return false;
	}
	if (
		action === 'upload' &&
		!data.catalogue?.some(
			(item) =>
				item.purpose.key === payload.purpose &&
				item.dataFormat.key === payload.dataFormatKey &&
				item.dataFormat.inputKind === 'UPLOAD'
		)
	) {
		return false;
	}
	if (
		['replaceSource', 'editSource'].includes(action) &&
		source?.currentlyPlanEntitled === false
	) {
		return false;
	}
	if (action === 'refreshSource' && source?.dataFormatKey !== 'WEB_PAGE') {
		return false;
	}
	if (
		action === 'reprocessSource' &&
		!['CSV', 'XLSX'].includes(source?.dataFormatKey)
	) {
		return false;
	}
	if (
		action === 'replaceSource' &&
		(!['CSV', 'XLSX'].includes(source?.dataFormatKey) ||
			source.dataFormatKey !== payload?.dataFormatKey ||
			source.purposeKey !== payload?.purpose)
	) {
		return false;
	}
	if (
		action === 'replaceSource' &&
		(!payload?.name?.trim() ||
			!payload.purpose ||
			!payload.languageTag ||
			!validKnowledgeFile(
				payload.file,
				data.maxUploadBytes,
				payload.dataFormatKey
			))
	) {
		return false;
	}
	if (
		action === 'editSource' &&
		(!payload?.name?.trim() ||
			!payload.languageTag ||
			(payload.url !== undefined && !validKnowledgeUrl(payload.url)))
	) {
		return false;
	}
	if (
		action === 'moveSource' &&
		(!Array.isArray(payload.sourceIds) ||
			payload.sourceIds.length !== data.sources.length ||
			new Set(payload.sourceIds).size !== data.sources.length ||
			payload.sourceIds.some(
				(id) => !data.sources.some((candidate) => candidate.id === id)
			))
	) {
		return false;
	}
	return true;
}
