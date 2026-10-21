// Fixture-only entrypoint: actual UI components and stylesheet, no live
// WordPress connection, merchant credentials, or production mock data.
import { createElement, createRoot } from '@wordpress/element';
import { MerchantKnowledgePanel } from '../../src/recovery-settings/merchant-knowledge/knowledge-panel';
import { StoreAssistantContext } from '../../src/recovery-settings/store-assistant-context';
import { StoreProfileAccordion } from '../../src/recovery-settings/store-profile-accordion';
import '../../src/index.scss';

const status = new URLSearchParams(window.location.search).get('status');
const readyFixture = {
	planEntitled: true,
	merchantEnabled: false,
	configuredCount: 0,
	maxKnowledgeSources: 3,
	maxUploadBytes: 2048,
	defaultLanguageTag: 'en',
	supportedLanguageTags: ['en'],
	permissions: { addUrl: true, upload: true },
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
			purpose: { key: 'FAQ', displayName: 'Frequently asked questions' },
			dataFormat: {
				key: 'CSV',
				inputKind: 'UPLOAD',
				canonicalExtension: '.csv',
			},
		},
	],
	sources: [],
};
const state =
	status === 'READY'
		? { status: 'READY', data: readyFixture }
		: {
				status: status === 'DENIED' ? 'DENIED' : 'UNAVAILABLE',
				data: null,
			};

const categoryState = {
	status: 'READY',
	categoryId: 'pets',
	mappingIds: [],
	data: {
		storeProfile: {
			activeCategory: { localizedDisplayName: 'Animals & Pet Supplies' },
			pendingCategory: null,
			pendingSelectionGeneration: 1,
			activeMappingIds: [],
			pendingState: 'NONE',
			pendingTemplate: null,
		},
		categories: [
			{
				id: 'pets',
				localizedDisplayName: 'Animals & Pet Supplies',
				localizedDescription: 'Pet supplies',
				mappings: [],
			},
		],
	},
};

createRoot(document.getElementById('merchant-knowledge-fixture')).render(
	createElement(StoreAssistantContext, {
		storeProfile: createElement(StoreProfileAccordion, {
			state: categoryState,
			onRefresh: () => {},
			onSave: () => {},
			onChoose: () => {},
			onToggleMapping: () => {},
		}),
		merchantKnowledge: createElement(MerchantKnowledgePanel, { state }),
	})
);
