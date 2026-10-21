import { describe, expect, it } from 'vitest';
import { StoreAssistantContext } from '../../src/recovery-settings/store-assistant-context';
import { StoreProfileAccordion } from '../../src/recovery-settings/store-profile-accordion';
import { MerchantKnowledgePanel } from '../../src/recovery-settings/merchant-knowledge/knowledge-panel';
import { KnowledgeUploadForm } from '../../src/recovery-settings/merchant-knowledge/knowledge-upload-form';
import { categoriesFixture } from './store-category-fixtures';

function children(node, type) {
	if (!node || typeof node !== 'object') {
		return [];
	}
	if (Array.isArray(node)) {
		return node.flatMap((child) => children(child, type));
	}
	if (node.type === KnowledgeUploadForm) {
		return []; // Hook owner: only render in a real React tree.
	}
	if (typeof node.type === 'function') {
		return children(node.type(node.props), type);
	}
	return [
		...(node.type === type ? [node] : []),
		...children(node.props?.children, type),
	];
}

function content(node) {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}
	if (Array.isArray(node)) {
		return node.map(content).join(' ');
	}
	if (typeof node !== 'object') {
		return String(node);
	}
	if (node.type === KnowledgeUploadForm) {
		return '';
	}
	if (typeof node.type === 'function') {
		return content(node.type(node.props));
	}
	return content(node.props?.children);
}

describe('Shopify parity: static context and child disclosures', () => {
	it('renders a static context with two separately mounted child cards', () => {
		const category = categoriesFixture();
		category.storeProfile.activeCategory = {
			localizedDisplayName: 'Animals & Pet Supplies',
		};
		const save = () => {};
		const refresh = () => {};
		const choose = () => {};
		const mapping = () => {};
		const profile = StoreProfileAccordion({
			state: {
				status: 'READY',
				data: category,
				categoryId: 'fashion',
				mappingIds: [],
			},
			onSave: save,
			onRefresh: refresh,
			onChoose: choose,
			onToggleMapping: mapping,
		});
		const knowledge = MerchantKnowledgePanel({
			state: {
				status: 'READY',
				data: {
					planEntitled: true,
					configuredCount: 0,
					maxKnowledgeSources: 10,
					sources: [],
				},
			},
		});
		const view = StoreAssistantContext({
			storeProfile: profile,
			merchantKnowledge: knowledge,
		});
		expect(view.type).toBe('section');
		expect(view.props['aria-labelledby']).toBe(
			'moda-interact-store-context-title'
		);
		expect(content(view)).toContain(
			'Store classification and reference material'
		);
		const disclosures = children(view, 'details').filter((item) =>
			['store-profile', 'merchant-knowledge'].includes(item.props.id)
		);
		expect(disclosures.map((item) => item.props.id)).toEqual([
			'store-profile',
			'merchant-knowledge',
		]);
		expect(disclosures.every((item) => item.props.open === undefined)).toBe(
			true
		);
		expect(content(disclosures[0])).toContain('Animals & Pet Supplies');
		expect(content(disclosures[1])).toContain('0 of 10 sources configured');
		expect(
			children(disclosures[0], 'button').find(
				(button) => button.props.onClick === save
			)
		).toBeDefined();
		const categorySelect = children(disclosures[0], 'select').find(
			(item) => item.props.id === 'moda-interact-store-category'
		);
		expect(categorySelect.props.onChange).toBeInstanceOf(Function);
		const summaries = disclosures.map((item) => item.props.children[0]);
		expect(summaries.every((summary) => summary.type === 'summary')).toBe(
			true
		);
	});

	it('does not invent labels or counts without source data', () => {
		const profile = StoreProfileAccordion({
			state: { status: 'ERROR', data: null },
		});
		const knowledge = MerchantKnowledgePanel({
			state: { status: 'UNAVAILABLE', data: null },
		});
		expect(content(profile)).not.toContain('Not selected');
		expect(content(knowledge)).not.toContain('0 of 0');
		expect(profile.props.open).toBeUndefined();
		expect(knowledge.props.open).toBeUndefined();
	});
});
