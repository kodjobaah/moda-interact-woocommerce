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
		addUrl: true,
		upload: true,
		moveSource: true,
		deleteSource: true,
		replaceSource: true,
		editSource: true,
		refreshSource: true,
		reprocessSource: true,
	},
	catalogue: [
		{
			purpose: { key: 'FAQ', displayName: 'Frequently asked questions' },
			dataFormat: {
				key: 'WEB_PAGE',
				inputKind: 'REMOTE_URL',
				canonicalExtension: null,
			},
		},
		{
			purpose: {
				key: 'PRODUCT_INFORMATION',
				displayName: 'Product information',
			},
			dataFormat: {
				key: 'XLSX',
				inputKind: 'UPLOAD',
				canonicalExtension: '.xlsx',
			},
		},
	],
	sources: [
		{
			id: 'a',
			name: 'FAQ',
			purposeKey: 'FAQ',
			dataFormatKey: 'WEB_PAGE',
			languageTag: 'en',
			currentlyPlanEntitled: true,
			processingEligible: true,
			revision: {
				status: 'ACTIVE',
				requestedUrl: 'https://example.com/help',
			},
		},
	],
});
const connected = (controller) => {
	controller.setConnection({
		status: 'CONNECTED',
		installationId: 'one',
		credentialVersion: 1,
	});
	controller.setActive(true);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Merchant Knowledge UI-only controller', () => {
	it('does not invent source state when the approved WordPress broker is unavailable', async () => {
		const client = createMerchantKnowledgeClient(async () => {
			throw { status: 503 };
		});
		expect(client).toHaveProperty('upload');
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		expect(controller.state).toEqual({ status: 'UNAVAILABLE', data: null });
		await controller.perform('addUrl', {
			url: 'https://example.com',
			name: 'Example',
		});
		expect(controller.state.status).toBe('UNAVAILABLE');
		controller.dispose();
	});

	it('shows server-acknowledged results only, deduplicates writes, and reloads after success', async () => {
		let release;
		const client = {
			read: vi.fn(async () => fixture()),
			addUrl: vi.fn(
				() =>
					new Promise((resolve) => {
						release = resolve;
					})
			),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		expect(controller.state.status).toBe('READY');
		const payload = {
			name: 'Shop information',
			url: 'https://example.com/help',
			purpose: 'FAQ',
			languageTag: 'en',
		};
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
		controller.setConnection({
			status: 'CONNECTED',
			installationId: 'two',
			credentialVersion: 2,
		});
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
		for (const [code, status] of [
			['DENIED', 'DENIED'],
			['CONFLICT', 'CONFLICT'],
			['offline', 'ERROR'],
		]) {
			const controller = new MerchantKnowledgeController({
				read: async () => {
					throw { code };
				},
			});
			connected(controller);
			await settle();
			expect(controller.state).toEqual({ status, data: null });
			controller.dispose();
		}
	});

	it('validates SSRF-prone URLs and matching file format/size before any action', () => {
		expect(validKnowledgeUrl('https://example.com/faq')).toBe(true);
		for (const url of [
			'http://example.com',
			'https://localhost/admin',
			'https://127.0.0.1',
			'https://10.0.1.1',
			'https://[::1]',
			'https://[fe80::1]',
			'https://example.com:8443',
			'https://user:pass@example.com',
			'https://example.com/#fragment',
			'https://backend.internal',
			'broken',
		]) {
			expect(validKnowledgeUrl(url)).toBe(false);
		}
		expect(
			validKnowledgeFile(
				{ name: 'catalogue.xlsx', size: 999 },
				1000,
				'XLSX'
			)
		).toBe(true);
		expect(
			validKnowledgeFile({ name: 'catalogue.csv', size: 1 }, 1000, 'CSV')
		).toBe(true);
		expect(
			validKnowledgeFile(
				{ name: 'catalogue.csv', size: 100 },
				1000,
				'XLSX'
			)
		).toBe(false);
		expect(
			validKnowledgeFile({ name: 'photo.png', size: 100 }, 1000, 'CSV')
		).toBe(false);
		expect(
			validKnowledgeFile(
				{ name: 'catalogue.xlsx', size: 1001 },
				1000,
				'XLSX'
			)
		).toBe(false);
	});

	it('never starts a replace/edit/move without a valid payload or acknowledged write', async () => {
		const client = {
			read: vi.fn(async () => fixture()),
			replaceSource: vi.fn(),
			editSource: vi.fn(),
			moveSource: vi.fn(),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		await controller.perform('replaceSource', {
			id: 'a',
			name: 'Bad',
			purpose: 'FAQ',
			languageTag: 'en',
			dataFormatKey: 'XLSX',
			file: { name: 'bad.csv', size: 22 },
		});
		await controller.perform('editSource', {
			id: 'a',
			name: 'Bad',
			languageTag: 'en',
			url: 'http://127.0.0.1',
		});
		await controller.perform('moveSource', {
			id: 'a',
			sourceIds: ['alien'],
		});
		expect(client.replaceSource).not.toHaveBeenCalled();
		expect(client.editSource).not.toHaveBeenCalled();
		expect(client.moveSource).not.toHaveBeenCalled();
		controller.dispose();
	});

	it.each(['PENDING', 'PROCESSING'])(
		'does not poll %s sources without a manual refresh',
		async (processingStatus) => {
			vi.useFakeTimers();
			try {
				let status = processingStatus;
				const client = {
					read: vi.fn(async () => ({
						...fixture(),
						sources: [
							{
								...fixture().sources[0],
								revision: { status },
							},
						],
					})),
				};
				const controller = new MerchantKnowledgeController(client);
				connected(controller);
				await vi.advanceTimersByTimeAsync(0);
				expect(client.read).toHaveBeenCalledTimes(1);
				await vi.advanceTimersByTimeAsync(65_000);
				expect(client.read).toHaveBeenCalledTimes(1);

				status = 'ACTIVE';
				await controller.refresh();
				expect(client.read).toHaveBeenCalledTimes(2);
				expect(controller.state.data.sources[0].revision.status).toBe(
					'ACTIVE'
				);
				await vi.advanceTimersByTimeAsync(65_000);
				expect(client.read).toHaveBeenCalledTimes(2);
				controller.dispose();
			} finally {
				vi.useRealTimers();
			}
		}
	);
});

describe('ARCH-035-WOOCOMMERCE-015 command failure and cancellation', () => {
	it('keeps the source UI and unsaved edits after a failed command', async () => {
		const original = fixture();
		const client = {
			read: vi.fn(async () => original),
			addUrl: vi.fn(async () => { throw { code: 'REMOTE_UNAVAILABLE' }; }),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		await controller.perform('addUrl', {
			name: 'Draft', purpose: 'FAQ', languageTag: 'en',
			url: 'https://example.org/help',
		});
		expect(controller.state.status).toBe('READY');
		expect(controller.state.error).toBe('ERROR');
		expect(controller.state.data).toBe(original);
		controller.dispose();
	});

	it('aborts active upload on credential rotation and ignores late finalisation', async () => {
		let release;
		const client = {
			read: vi.fn(async () => fixture()),
			upload: vi.fn((_payload, { signal }) => new Promise((resolve) => {
				release = () => resolve({ status: 'ACCEPTED' });
				signal.addEventListener('abort', () => resolve({ status: 'ACCEPTED' }));
			})),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		const saved = controller.perform('upload', {
			name: 'Source', purpose: 'PRODUCT_INFORMATION',
			languageTag: 'en', dataFormatKey: 'XLSX',
			file: { name: 'item.xlsx', size: 40 },
		});
		await settle();
		expect(controller.state.status).toBe('SAVING');
		controller.setConnection({
			status: 'CONNECTED', installationId: 'rotated', credentialVersion: 2,
		});
		await saved;
		expect(client.read).toHaveBeenCalledTimes(2);
		expect(controller.state.status).toBe('READY');
		release();
		controller.dispose();
	});
});

describe('ARCH-035-WOOCOMMERCE-015 source-write acknowledgements', () => {
	const payload = {
		name: 'New source', purpose: 'FAQ', languageTag: 'en',
		url: 'https://example.org/new',
	};

	it('uses the authoritative complete command snapshot without a second GET', async () => {
		const original = fixture();
		const updated = {
			...original, configuredCount: 2, nextPosition: null,
			sources: [...original.sources, { ...original.sources[0], id: 'new_2' }],
		};
		const client = {
			read: vi.fn(async () => original),
			addUrl: vi.fn(async () => ({ created: true, sourceId: 'new_2', knowledge: updated })),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		const result = await controller.perform('addUrl', payload);
		expect(result.confirmedAction).toBe('addUrl');
		expect(client.read).toHaveBeenCalledTimes(1);
		expect(controller.state).toMatchObject({ status: 'READY', data: updated });
		expect(controller.state.data.sources).toHaveLength(2);
		controller.dispose();
	});

	it('does not confirm an unsuccessful web-page addition', async () => {
		const client = {
			read: vi.fn(async () => fixture()),
			addUrl: vi.fn(async () => { throw { code: 'DENIED' }; }),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		const result = await controller.perform('addUrl', payload);
		expect(result.confirmedAction).toBeUndefined();
		expect(result.error).toBe('DENIED');
		controller.dispose();
	});

	it('fetches the complete list when command acknowledgement is paginated', async () => {
		const original = fixture();
		const updated = { ...original, configuredCount: 2, sources: original.sources };
		const client = {
			read: vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(updated),
			addUrl: vi.fn(async () => ({ knowledge: { ...updated, nextPosition: 1 } })),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		await controller.perform('addUrl', payload);
		expect(client.read).toHaveBeenCalledTimes(2);
		expect(controller.state.status).toBe('READY');
		controller.dispose();
	});

	it('distinguishes a successful write from an unavailable follow-up read', async () => {
		const original = fixture();
		const updated = { ...original, configuredCount: 2 };
		const client = {
			read: vi.fn().mockResolvedValueOnce(original)
				.mockRejectedValueOnce({ code: 'REMOTE_UNAVAILABLE' })
				.mockResolvedValueOnce(updated),
			addUrl: vi.fn(async () => ({ created: true })),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		const result = await controller.perform('addUrl', payload);
		expect(result.confirmedAction).toBe('addUrl');
		expect(controller.state).toMatchObject({
			status: 'READY', data: original, error: 'SAVED_NEEDS_REFRESH',
			needsRefresh: true,
		});
		await controller.perform('addUrl', payload);
		expect(client.addUrl).toHaveBeenCalledTimes(1);
		await controller.refresh();
		expect(controller.state).toMatchObject({ status: 'READY', data: updated });
		expect(controller.state.needsRefresh).toBeUndefined();
		controller.dispose();
	});

	it('reports upload completion only after finalisation, even if the next read fails', async () => {
		const original = fixture();
		const client = {
			read: vi.fn().mockResolvedValueOnce(original)
				.mockRejectedValueOnce({ code: 'REMOTE_UNAVAILABLE' }),
			upload: vi.fn(async () => ({ status: 'ACCEPTED' })),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		const confirmed = await controller.perform('upload', {
			name: 'Products', purpose: 'PRODUCT_INFORMATION',
			dataFormatKey: 'XLSX', languageTag: 'en',
			file: { name: 'products.xlsx', size: 40 },
		});
		expect(confirmed.confirmedAction).toBe('upload');
		expect(controller.state).toMatchObject({
			status: 'READY', error: 'SAVED_NEEDS_REFRESH', needsRefresh: true,
		});
		expect(controller.state).not.toHaveProperty('confirmedAction');
		controller.dispose();
	});

	it('never signals upload completion after a failed finalisation', async () => {
		const client = {
			read: vi.fn(async () => fixture()),
			upload: vi.fn(async () => { throw { code: 'UPLOAD_FAILED' }; }),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		const failed = await controller.perform('upload', {
			name: 'Products', purpose: 'PRODUCT_INFORMATION',
			dataFormatKey: 'XLSX', languageTag: 'en',
			file: { name: 'products.xlsx', size: 40 },
		});
		expect(failed).not.toHaveProperty('confirmedAction');
		expect(controller.state.error).toBe('ERROR');
		controller.dispose();
	});

	it('preserves known data and blocks writes after a refresh failure', async () => {
		const original = fixture();
		const client = {
			read: vi.fn().mockResolvedValueOnce(original)
				.mockRejectedValueOnce({ code: 'REMOTE_UNAVAILABLE' }),
			addUrl: vi.fn(),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		await controller.refresh();
		expect(controller.state).toMatchObject({
			status: 'READY', data: original, error: 'REFRESH_FAILED',
			needsRefresh: true,
		});
		await controller.perform('addUrl', payload);
		expect(client.addUrl).not.toHaveBeenCalled();
		controller.dispose();
	});

	it('treats transport errors during a write as an unconfirmed outcome', async () => {
		const original = fixture();
		const client = {
			read: vi.fn(async () => original),
			addUrl: vi.fn(async () => { throw { code: 'KNOWLEDGE_UNAVAILABLE' }; }),
		};
		const controller = new MerchantKnowledgeController(client);
		connected(controller);
		await settle();
		await controller.perform('addUrl', payload);
		expect(controller.state).toMatchObject({
			status: 'READY', data: original, error: 'VERIFY_REQUIRED',
			needsRefresh: true,
		});
		await controller.perform('addUrl', payload);
		expect(client.addUrl).toHaveBeenCalledTimes(1);
		controller.dispose();
	});
});
