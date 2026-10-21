import { describe, it, expect, vi } from 'vitest';
import {
	KNOWLEDGE_PATH,
	createMerchantKnowledgeClient,
} from '../../src/recovery-settings/merchant-knowledge/knowledge-client';
import { parseKnowledgePage } from '../../src/recovery-settings/merchant-knowledge/knowledge-response';

const source = (id, position = 1, format = 'WEB_PAGE') => ({
	id,
	name: 'Fixture',
	purposeKey: 'FAQ',
	purposeDisplayName: 'FAQ',
	dataFormatKey: format,
	dataFormatDisplayName: format,
	uploadedFileName: format === 'WEB_PAGE' ? null : 'faq.csv',
	languageTag: 'en',
	position,
	currentGeneration: 1,
	currentlyPlanEntitled: true,
	processingEligible: false,
	dormantReason: 'MERCHANT_DISABLED',
	revision: {
		id: 'rev_1',
		generation: 1,
		reason: 'CREATE',
		status: 'ACTIVE',
		requestedUrl: format === 'WEB_PAGE' ? 'https://example.org/help' : null,
		resolvedUrl: null,
		contentUnits: 30,
		truncated: false,
		fetchedAt: null,
		completedAt: null,
		failureCode: null,
		activeContentUnits: 30,
		activeTruncated: false,
		activeFetchedAt: null,
	},
	activeRevision: null,
});

const catalogue = () => [
	{
		purpose: { key: 'FAQ', displayName: 'FAQ' },
		dataFormat: {
			key: 'WEB_PAGE',
			displayName: 'Web page',
			inputKind: 'REMOTE_URL',
			canonicalExtension: null,
			acceptedContentTypes: [],
		},
	},
	{
		purpose: { key: 'FAQ', displayName: 'FAQ' },
		dataFormat: {
			key: 'CSV',
			displayName: 'CSV',
			inputKind: 'UPLOAD',
			canonicalExtension: '.csv',
			acceptedContentTypes: ['text/csv'],
		},
	},
];

const knowledge = (sources = [source('web_1')]) => ({
	schemaVersion: 1,
	state: 'MERCHANT_DISABLED',
	planEntitled: true,
	merchantEnabled: false,
	effectiveEnabled: false,
	maxKnowledgeSources: 10,
	maxContentUnitsPerSource: 1000,
	maxUploadBytes: 1000000,
	configuredCount: sources.length,
	planEligibleSourceCount: sources.length,
	defaultLanguageTag: 'en',
	supportedLanguageTags: ['en', 'fr'],
	catalogue: catalogue(),
	sources,
	nextPosition: null,
});

const result = (data) => ({
	knowledge: data,
	sourceId: 'web_1',
	created: false,
});

describe('ARCH-035-WOOCOMMERCE-015 knowledge client', () => {
	it('renders authoritative capacity/catalogue while the merchant feature is off', async () => {
		const request = vi.fn(async () => knowledge());
		const data = await createMerchantKnowledgeClient(request).read();
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				path: KNOWLEDGE_PATH,
				method: 'GET',
			})
		);
		expect(data.configuredCount).toBe(1);
		expect(data.merchantEnabled).toBe(false);
		expect(data.permissions.addUrl).toBe(true);
		expect(data.permissions.upload).toBe(true);
		expect(data.sources).toHaveLength(1);
	});

	it('rejects missing fields, injected permissions and spoofed current states', () => {
		for (const bad of [
			{ ...knowledge(), permissions: { upload: true } },
			{ ...knowledge(), configuredCount: '0' },
			{
				...knowledge(),
				sources: [{ ...source('web_1'), secret: 'not allowed' }],
			},
			{ ...knowledge(), effectiveEnabled: true },
		]) {
			expect(() => parseKnowledgePage(bad)).toThrow('KNOWLEDGE_INVALID');
		}
	});

	it('sends correct generation-CAS actions, file edit and no-body reprocess', async () => {
		const writes = [];
		const request = vi.fn(async (args) => {
			writes.push(args);
			if (args.path.endsWith('/reprocess')) {
				return {
					schemaVersion: 1,
					sourceId: 'csv_1',
					revisionId: 'rev_2',
					generation: 2,
					status: 'ACCEPTED',
				};
			}
			if (args.path.endsWith('/uploads/csv_1')) {
				return { schemaVersion: 1, sourceId: 'csv_1', updated: true };
			}
			return result(knowledge());
		});
		const client = createMerchantKnowledgeClient(request);
		const snapshot = {
			...knowledge([source('web_1'), source('csv_1', 2, 'CSV')]),
		};
		const context = { snapshot };
		const acknowledged = await client.addUrl(
			{
				name: 'New',
				purpose: 'FAQ',
				languageTag: 'en',
				url: 'https://example.org/help',
			},
			context
		);
		expect(acknowledged.knowledge.permissions.addUrl).toBe(true);
		expect(acknowledged.knowledge.nextPosition).toBe(null);
		await client.editSource(
			{
				id: 'web_1',
				name: 'Updated',
				languageTag: 'en',
				url: 'https://example.org/help',
			},
			context
		);
		await client.refreshSource({ id: 'web_1' }, context);
		await client.deleteSource({ id: 'web_1' }, context);
		await client.moveSource({ sourceIds: ['csv_1', 'web_1'] }, context);
		await client.editSource(
			{ id: 'csv_1', name: 'CSV updated', languageTag: 'en' },
			context
		);
		await client.reprocessSource({ id: 'csv_1' }, context);
		expect(writes[0].data).toEqual({
			name: 'New',
			purposeKey: 'FAQ',
			dataFormatKey: 'WEB_PAGE',
			url: 'https://example.org/help',
			languageTag: 'en',
		});
		expect(writes[1].data.expectedGeneration).toBe(1);
		expect(writes[2].data).toEqual({ expectedGeneration: 1 });
		expect(writes[3].method).toBe('DELETE');
		expect(writes[3].data).toEqual({ expectedGeneration: 1 });
		expect(writes[4].data).toEqual({ sourceIds: ['csv_1', 'web_1'] });
		expect(writes[5].path).toContain('/uploads/csv_1');
		expect(writes[5].data).toEqual({
			name: 'CSV updated',
			languageTag: 'en',
		});
		expect(writes[6]).not.toHaveProperty('data');
	});

	it('follows authoritative pagination without accepting duplicate source IDs', async () => {
		const first = {
			...knowledge([source('web_1')]),
			configuredCount: 2,
			nextPosition: 1,
		};
		const second = {
			...knowledge([source('csv_1', 2, 'CSV')]),
			configuredCount: 2,
		};
		const request = vi
			.fn()
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);
		const data = await createMerchantKnowledgeClient(request).read();
		expect(request.mock.calls[1][0].path).toBe(
			`${KNOWLEDGE_PATH}?afterPosition=1`
		);
		expect(data.sources.map((row) => row.id)).toEqual(['web_1', 'csv_1']);
	});

	it.each([
		[401, 'RECONNECT_REQUIRED'],
		[403, 'DENIED'],
		[409, 'CONFLICT'],
		[503, 'KNOWLEDGE_UNAVAILABLE'],
	])('fails closed on REST HTTP %s', async (status, code) => {
		const request = vi.fn(async () => {
			throw { status };
		});
		await expect(
			createMerchantKnowledgeClient(request).read()
		).rejects.toMatchObject({ code });
	});
});

export { knowledge, source, catalogue };
