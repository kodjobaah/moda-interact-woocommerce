import { describe, it, expect, vi } from 'vitest';
import { MerchantKnowledgeController } from '../../src/recovery-settings/merchant-knowledge/knowledge-controller';
import {
	createMerchantKnowledgeClient,
	validKnowledgeFile,
	validKnowledgeUrl,
} from '../../src/recovery-settings/merchant-knowledge/knowledge-client';

const fixture = () => ({
	planEntitled: true,
	merchantEnabled: false,
	configuredCount: 1,
	planEligibleSourceCount: 1,
	maxKnowledgeSources: 5,
	maxUploadBytes: 1000,
	defaultLanguageTag: 'en',
	supportedLanguageTags: ['en'],
	permissions: {
		addUrl: true, upload: true, moveSource: true, deleteSource: true,
		replaceSource: true, editSource: true, refreshSource: true, reprocessSource: true,
	},
	catalogue: [
		{ purpose: { key: 'FAQ', displayName: 'Frequently asked questions' }, dataFormat: { key: 'WEB_PAGE', inputKind: 'REMOTE_URL', canonicalExtension: null } },
		{ purpose: { key: 'PRODUCT_INFORMATION', displayName: 'Product information' }, dataFormat: { key: 'XLSX', inputKind: 'UPLOAD', canonicalExtension: '.xlsx' } },
	],
	sources: [{ id: 'a', name: 'FAQ', purposeKey: 'FAQ', dataFormatKey: 'WEB_PAGE', languageTag: 'en', currentlyPlanEntitled: true, processingEligible: true, revision: { status: 'ACTIVE', requestedUrl: 'https://example.com/help' } }],
});
const connected = (controller) => {
	controller.setConnection({ status: 'CONNECTED', installationId: 'one', credentialVersion: 1 });
	controller.setActive(true);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Merchant Knowledge UI-only controller', () => {
	it('refuses unapproved production read/write operations and never calls a hosted endpoint', async () => {
		const client = createMerchantKnowledgeClient();
		expect(client).not.toHaveProperty('upload');
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		expect(controller.state).toEqual({ status: 'UNAVAILABLE', data: null });
		await controller.perform('addUrl', { url: 'https://example.com', name: 'Example' });
		expect(controller.state.status).toBe('UNAVAILABLE');
		controller.dispose();
	});

	it('shows server-acknowledged results only, deduplicates writes, and reloads after success', async () => {
		let release;
		const client = {
			read: vi.fn(async () => fixture()),
			addUrl: vi.fn(() => new Promise((resolve) => { release = resolve; })),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		expect(controller.state.status).toBe('READY');
		const payload = { name: 'Shop information', url: 'https://example.com/help', purpose: 'FAQ', languageTag: 'en' };
		const request = controller.perform('addUrl', payload);
		const repeated = controller.perform('addUrl', payload);
		await settle();
		expect(controller.state.status).toBe('SAVING');
		expect(client.addUrl).toHaveBeenCalledTimes(1);
		expect(controller.state.data.sources).toHaveLength(1);
		release();
		await Promise.all([request, repeated]);
		expect(client.read).toHaveBeenCalledTimes(2);
		expect(controller.state.status).toBe('READY');
		controller.dispose();
	});

	it('ignores late completions after credential rotation, disconnect and dispose', async () => {
		const callbacks = [];
		const controller = new MerchantKnowledgeController({
			read: () => new Promise((resolve) => callbacks.push(resolve)),
		});
		connected(controller);
		await settle();
		controller.setConnection({ status: 'CONNECTED', installationId: 'two', credentialVersion: 2 });
		await settle();
		callbacks[0](fixture());
		await settle();
		expect(controller.state.status).toBe('LOADING');
		controller.setConnection({ status: 'SITE_URL_CHANGED' });
		callbacks[1](fixture());
		await settle();
		expect(controller.state).toEqual({ status: 'IDLE', data: null });
		controller.dispose();
	});

	it('maps denied/conflict/network errors without inventing source records', async () => {
		for (const [code, status] of [['DENIED', 'DENIED'], ['CONFLICT', 'CONFLICT'], ['offline', 'ERROR']]) {
			const controller = new MerchantKnowledgeController({ read: async () => { throw { code }; } });
			connected(controller);
			await settle();
			expect(controller.state).toEqual({ status, data: null });
			controller.dispose();
		}
	});

	it('validates SSRF-prone URLs and matching file format/size before any action', () => {
		expect(validKnowledgeUrl('https://example.com/faq')).toBe(true);
		for (const url of [
			'http://example.com', 'https://localhost/admin', 'https://127.0.0.1',
			'https://10.0.1.1', 'https://[::1]', 'https://[fe80::1]',
			'https://example.com:8443', 'https://user:pass@example.com',
			'https://example.com/#fragment', 'https://backend.internal', 'broken',
		]) expect(validKnowledgeUrl(url)).toBe(false);
		expect(validKnowledgeFile({ name: 'catalogue.xlsx', size: 999 }, 1000, 'XLSX')).toBe(true);
		expect(validKnowledgeFile({ name: 'catalogue.csv', size: 1 }, 1000, 'CSV')).toBe(true);
		expect(validKnowledgeFile({ name: 'catalogue.csv', size: 100 }, 1000, 'XLSX')).toBe(false);
		expect(validKnowledgeFile({ name: 'photo.png', size: 100 }, 1000, 'CSV')).toBe(false);
		expect(validKnowledgeFile({ name: 'catalogue.xlsx', size: 1001 }, 1000, 'XLSX')).toBe(false);
	});

	it('never starts a replace/edit/move without a valid payload or acknowledged write', async () => {
		const client = { read: vi.fn(async () => fixture()), replaceSource: vi.fn(), editSource: vi.fn(), moveSource: vi.fn() };
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		await controller.perform('replaceSource', { id: 'a', name: 'Bad', purpose: 'FAQ', languageTag: 'en', dataFormatKey: 'XLSX', file: { name: 'bad.csv', size: 22 } });
		await controller.perform('editSource', { id: 'a', name: 'Bad', languageTag: 'en', url: 'http://127.0.0.1' });
		await controller.perform('moveSource', { id: 'a', sourceIds: ['alien'] });
		expect(client.replaceSource).not.toHaveBeenCalled();
		expect(client.editSource).not.toHaveBeenCalled();
		expect(client.moveSource).not.toHaveBeenCalled();
		controller.dispose();
	});

	it('polls eligible processing sources while active, stops after completion and on disconnect', async () => {
		vi.useFakeTimers();
		try {
			let loading = true;
			const client = { read: vi.fn(async () => ({ ...fixture(), sources: [{ ...fixture().sources[0], revision: { status: loading ? 'PROCESSING' : 'ACTIVE' } }] })) };
			const controller = new MerchantKnowledgeController(client);
			connected(controller);
			await vi.advanceTimersByTimeAsync(0);
			expect(client.read).toHaveBeenCalledTimes(1);
			loading = false;
			await vi.advanceTimersByTimeAsync(4000);
			expect(client.read).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(8000);
			expect(client.read).toHaveBeenCalledTimes(2);
			controller.setConnection({ status: 'DISCONNECTED' });
			controller.dispose();
		} finally {
			vi.useRealTimers();
		}
	});
});
