import { describe, it, expect, vi } from 'vitest';
import { MerchantKnowledgePanel } from '../../src/recovery-settings/merchant-knowledge/knowledge-panel';
import { KnowledgeSourceList } from '../../src/recovery-settings/merchant-knowledge/knowledge-source-list';
import { KnowledgeWebForm } from '../../src/recovery-settings/merchant-knowledge/knowledge-web-form';
import {
	KnowledgeUploadForm,
	KnowledgeUploadFields,
} from '../../src/recovery-settings/merchant-knowledge/knowledge-upload-form';
import {
	catalogueFor,
	sourceCapacityAvailable,
	sourceStatus,
} from '../../src/recovery-settings/merchant-knowledge/knowledge-display';

// No hook invocation outside a React renderer. The upload hook wrapper is
// inspected separately through its pure, fixture-renderable Fields component.
function nodes(node, type) {
	if (!node || typeof node !== 'object') {
		return [];
	}
	if (Array.isArray(node)) {
		return node.flatMap((item) => nodes(item, type));
	}
	if (node.type === KnowledgeUploadForm) {
		return node.type === type ? [node] : [];
	}
	if (typeof node.type === 'function') {
		return nodes(node.type(node.props), type);
	}
	return [
		...(node.type === type ? [node] : []),
		...nodes(node.props?.children, type),
	];
}
function text(node) {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}
	if (Array.isArray(node)) {
		return node.map(text).join(' ');
	}
	if (typeof node !== 'object') {
		return String(node);
	}
	if (node.type === KnowledgeUploadForm) {
		return '';
	}
	if (typeof node.type === 'function') {
		return text(node.type(node.props));
	}
	return text(node.props?.children);
}
const data = {
	schemaVersion: 1,
	configuredCount: 3,
	planEligibleSourceCount: 3,
	maxKnowledgeSources: 5,
	maxUploadBytes: 2048,
	planEntitled: true,
	merchantEnabled: false,
	defaultLanguageTag: 'en',
	supportedLanguageTags: ['en', 'fr'],
	permissions: {
		addUrl: true,
		upload: false,
		deleteSource: false,
		moveSource: true,
		refreshSource: true,
		reprocessSource: true,
		editSource: true,
		replaceSource: true,
	},
	catalogue: [
		{
			purpose: {
				key: 'COMPANY_INFORMATION',
				displayName: 'Company information',
			},
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
		{
			purpose: {
				key: 'PRODUCT_INFORMATION',
				displayName: 'Product information',
			},
			dataFormat: {
				key: 'CSV',
				inputKind: 'UPLOAD',
				canonicalExtension: '.csv',
			},
		},
	],
	sources: [
		{
			id: 'a',
			name: 'Products',
			purposeKey: 'COMPANY_INFORMATION',
			dataFormatKey: 'WEB_PAGE',
			languageTag: 'en',
			currentlyPlanEntitled: true,
			processingEligible: true,
			revision: {
				status: 'ACTIVE',
				requestedUrl: 'https://example.com/products',
				activeContentUnits: 12,
				activeTruncated: true,
				activeFetchedAt: '2026-10-18T12:00:00.000Z',
			},
		},
		{
			id: 'b',
			name: 'Import',
			purposeKey: 'PRODUCT_INFORMATION',
			dataFormatKey: 'XLSX',
			uploadedFileName: 'items.xlsx',
			languageTag: 'en',
			currentlyPlanEntitled: true,
			processingEligible: true,
			revision: { status: 'PROCESSING' },
		},
		{
			id: 'c',
			name: 'Shipping',
			purposeKey: 'COMPANY_INFORMATION',
			dataFormatKey: 'WEB_PAGE',
			languageTag: 'en',
			currentlyPlanEntitled: true,
			processingEligible: true,
			revision: { status: 'FAILED', failureCode: 'FETCH_TIMEOUT' },
		},
	],
};

describe('Merchant Knowledge Shopify-parity fixture UI', () => {
	it('refuses additions when configured sources reach the plan limit, even if fewer are eligible', () => {
		expect(
			sourceCapacityAvailable({
				...data,
				configuredCount: 5,
				planEligibleSourceCount: 2,
			})
		).toBe(false);
		expect(
			sourceCapacityAvailable({
				...data,
				configuredCount: 4,
				planEligibleSourceCount: 2,
			})
		).toBe(true);
	});

	it.each([
		['IDLE', 'Loading…', 0],
		['LOADING', 'Loading…', 0],
		['UNAVAILABLE', 'not yet available', 1],
		['DENIED', 'permission', 1],
		['CONFLICT', 'changed elsewhere', 1],
		['ERROR', 'could not be loaded', 1],
	])(
		'renders %s honestly without making up catalogue or counts',
		(status, message, retry) => {
			const view = MerchantKnowledgePanel({
				state: { status, data: null },
			});
			expect(text(view)).toContain(message);
			expect(text(view)).not.toContain('0 of 0');
			expect(
				nodes(view, 'button').filter((button) => !button.props.disabled)
			).toHaveLength(retry);
			expect(nodes(view, 'li')).toHaveLength(0);
		}
	);

	it('keeps unavailable add disclosures visible with all configuration controls disabled', () => {
		const view = MerchantKnowledgePanel({
			state: { status: 'UNAVAILABLE', data: null },
		});
		const summaries = nodes(view, 'summary');
		const controls = [
			...nodes(view, 'input'),
			...nodes(view, 'select'),
			...nodes(view, 'button').filter(
				(button) => button.props.type === 'submit'
			),
		];

		expect(
			summaries.slice(1).map((summary) => text(summary).trim())
		).toEqual(['Add web page Web page', 'Upload file']);
		expect(nodes(view, 'form')).toHaveLength(1);
		expect(nodes(view, KnowledgeUploadForm)).toHaveLength(1);
		expect(nodes(view, KnowledgeUploadForm)[0].props.enabled).toBe(false);
		expect(controls.length).toBeGreaterThan(0);
		expect(controls.every((control) => control.props.disabled)).toBe(true);
		expect(nodes(view, 'li')).toHaveLength(0);
		const placeholders = nodes(view, 'section').filter(
			(node) =>
				node.props.className === 'moda-knowledge__sources-placeholder'
		);
		expect(placeholders).toHaveLength(1);
		expect(placeholders[0].props['aria-labelledby']).toBe(
			'merchant-knowledge-sources-unavailable'
		);
		expect(text(placeholders[0])).toContain(
			'Knowledge sources could not be loaded'
		);
		expect(text(view)).not.toContain('No knowledge sources configured.');
		expect(text(view)).not.toContain('sources configured');
		const inaccessible = MerchantKnowledgePanel({
			state: { status: 'DENIED', data: null },
		});
		expect(
			nodes(inaccessible, 'section').filter(
				(node) =>
					node.props.className ===
					'moda-knowledge__sources-placeholder'
			)
		).toHaveLength(0);
	});

	it('preserves browser-native keyboard disclosure semantics in the unavailable state', () => {
		const view = MerchantKnowledgePanel({
			state: { status: 'UNAVAILABLE', data: null },
		});
		const details = nodes(view, 'details');
		const summaries = nodes(view, 'summary');
		expect(details).toHaveLength(3); // Section, web, file.
		expect(summaries).toHaveLength(3);
		for (const summary of summaries) {
			// <summary> is keyboard focusable/activatable natively; custom
			// button roles or key handlers would undermine that behaviour.
			expect(summary.props.tabIndex).toBeUndefined();
			expect(summary.props.role).toBeUndefined();
			expect(summary.props.onKeyDown).toBeUndefined();
			expect(summary.props.onClick).toBeUndefined();
		}
		const buttons = nodes(view, 'button');
		expect(
			buttons
				.filter((node) => node.props.type === 'submit')
				.every((node) => node.props.disabled === true)
		).toBe(true);
	});

	it('uses nested native disclosure, clear disabled notice, header count, stacked add forms and metadata', () => {
		const view = MerchantKnowledgePanel({
			state: { status: 'READY', data },
		});
		expect(view.type).toBe('details');
		expect(view.props['aria-labelledby']).toBe('merchant-knowledge-title');
		expect(nodes(view, 'summary')).toHaveLength(7); // section, two add disclosures, three edit forms, one replace
		expect(nodes(view, 'summary')[0].props.className).toBe(
			'moda-knowledge__heading'
		);
		expect(text(view)).toContain('3 of 5 sources configured');
		expect(text(view)).toContain('Ingestion and retrieval are disabled');
		expect(text(view)).toContain('12 active content units');
		expect(text(view)).toContain('truncated');
		expect(text(view)).toContain('items.xlsx');
		for (const value of [
			'Products',
			'Import',
			'Shipping',
			'Ready',
			'Processing',
			'Failed',
		]) {
			expect(text(view)).toContain(value);
		}
		expect(nodes(view, 'li')).toHaveLength(3);
		const forms = nodes(view, 'form');
		expect(forms.length).toBeGreaterThanOrEqual(2); // web add + edit cards; upload uses hook wrapper
		expect(nodes(view, KnowledgeUploadForm)).toHaveLength(2); // new upload and file replacement
		expect(
			nodes(view, 'input').some(
				(item) => item.props.readOnly && item.props.value === 'Web page'
			)
		).toBe(true);
		expect(
			nodes(view, 'button')
				.filter((item) => text(item) === 'Delete')
				.every((item) => item.props.disabled)
		).toBe(true);
	});

	it('does not treat a disabled conversation feature as loss of plan entitlement', () => {
		const view = MerchantKnowledgePanel({
			state: { status: 'READY', data },
		});
		expect(
			nodes(view, 'input').some(
				(node) => node.props.name === 'url' && !node.props.disabled
			)
		).toBe(true);
		const blocked = MerchantKnowledgePanel({
			state: { status: 'READY', data: { ...data, planEntitled: false } },
		});
		expect(text(blocked)).toContain('unavailable on the current plan');
		expect(nodes(blocked, 'li')).toHaveLength(0);
		const empty = MerchantKnowledgePanel({
			state: {
				status: 'READY',
				data: {
					...data,
					sources: [],
					configuredCount: 0,
					planEligibleSourceCount: 0,
				},
			},
		});
		expect(text(empty)).toContain('No knowledge sources configured.');
	});

	it('limits actions by actual source format and live permissions, and reorders deterministically', () => {
		const onAction = vi.fn();
		const view = KnowledgeSourceList({
			sources: data.sources,
			data,
			permissions: data.permissions,
			onAction,
		});
		const all = nodes(view, 'button');
		const ups = all.filter((item) => text(item) === 'Move source up');
		expect(ups[0].props.disabled).toBe(true);
		const downs = all.filter((item) => text(item) === 'Move source down');
		downs[0].props.onClick();
		expect(onAction).toHaveBeenCalledWith('moveSource', {
			id: 'a',
			direction: 'DOWN',
			sourceIds: ['b', 'a', 'c'],
		});
		expect(all.filter((item) => text(item) === 'Refresh')).toHaveLength(2);
		expect(all.filter((item) => text(item) === 'Reprocess')).toHaveLength(
			1
		);
		expect(
			sourceStatus({
				dormantReason: 'MERCHANT_DISABLED',
				revision: { status: 'ACTIVE' },
			}).tone
		).toBe('paused');
		expect(
			sourceStatus({
				dormantReason: 'SOURCE_COUNT',
				revision: { status: 'ACTIVE' },
			}).tone
		).toBe('inactive');
		expect(
			sourceStatus({
				dormantReason: null,
				revision: { status: 'SUPERSEDED' },
			}).label
		).toBe('Superseded');
	});

	it('filters purpose/data-format combinations and validates URL submission locally', () => {
		expect(catalogueFor(data, 'REMOTE_URL')).toHaveLength(1);
		expect(catalogueFor(data, 'UPLOAD')).toHaveLength(2);
		const onAction = vi.fn();
		const form = KnowledgeWebForm({
			data,
			catalogue: catalogueFor(data, 'REMOTE_URL'),
			disabled: false,
			onAction,
		});
		const submitted = (url) => ({
			preventDefault: vi.fn(),
			currentTarget: {
				elements: {
					namedItem: (key) =>
						({
							name: 'Store',
							purpose: 'COMPANY_INFORMATION',
							languageTag: 'en',
							url,
						})[key] === undefined
							? null
							: {
									value: {
										name: 'Store',
										purpose: 'COMPANY_INFORMATION',
										languageTag: 'en',
										url,
									}[key],
								},
				},
			},
		});
		form.props.onSubmit(submitted('http://127.0.0.1'));
		expect(onAction).not.toHaveBeenCalled();
		form.props.onSubmit(submitted('https://example.com/help'));
		expect(onAction).toHaveBeenCalledWith('addUrl', {
			name: 'Store',
			purpose: 'COMPANY_INFORMATION',
			languageTag: 'en',
			url: 'https://example.com/help',
		});
	});

	it('keeps native file submit disabled until a valid selected file and editable name are supplied', () => {
		const onFileChange = vi.fn();
		const form = KnowledgeUploadFields({
			data,
			all: catalogueFor(data, 'UPLOAD'),
			forPurpose: catalogueFor(data, 'UPLOAD'),
			purpose: 'PRODUCT_INFORMATION',
			selectedFormat: 'XLSX',
			name: '',
			file: null,
			disabled: false,
			canSubmit: false,
			onFileChange,
			onPurposeChange: vi.fn(),
			onFormatChange: vi.fn(),
			onNameChange: vi.fn(),
			onSubmit: vi.fn(),
		});
		const fileInput = nodes(form, 'input').find(
			(node) => node.props.type === 'file'
		);
		expect(fileInput.props.accept).toBe('.xlsx');
		fileInput.props.onChange({
			currentTarget: { files: [{ name: 'products.xlsx', size: 600 }] },
		});
		expect(onFileChange).toHaveBeenCalledWith({
			name: 'products.xlsx',
			size: 600,
		});
		expect(
			nodes(form, 'button').find((node) => text(node) === 'Upload file')
				.props.disabled
		).toBe(true);
		expect(text(form)).toContain('Maximum upload size: 2048 bytes');
	});
});
