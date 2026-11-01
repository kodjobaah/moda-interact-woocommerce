import { describe, expect, it } from 'vitest';
import { RecoverySettingsScreen } from '../../src/recovery-settings/recovery-settings-screen';
import { RecoveryBehaviourPanel } from '../../src/recovery-settings/recovery-behaviour-panel';
import {
	AiResponseDelayPanel,
	AiResponseDelayFields,
} from '../../src/recovery-settings/ai-response-delay-panel';
import { FeaturePreferencesPanel } from '../../src/recovery-settings/feature-preferences-panel';
import { WhatsAppConsentGuidance } from '../../src/recovery-settings/whatsapp-consent-guidance';
import { MerchantKnowledgePanel } from '../../src/recovery-settings/merchant-knowledge/knowledge-panel';
import { StoreAssistantContext } from '../../src/recovery-settings/store-assistant-context';
import { StoreProfileAccordion } from '../../src/recovery-settings/store-profile-accordion';
import { RecoveryNavigation } from '../../src/recovery-settings/recovery-navigation';
import { categoriesFixture } from './store-category-fixtures';

function flatten(node) {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}
	if (Array.isArray(node)) {
		return node.map(flatten).join(' ');
	}
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}
	if (
		node.type === RecoveryBehaviourPanel ||
		node.type === AiResponseDelayPanel
	) {
		return ''; // React hook owner is tested through its pure view.
	}
	if (typeof node.type === 'function') {
		return flatten(node.type(node.props));
	}
	return flatten(node.props?.children);
}

function buttons(node, found = []) {
	if (Array.isArray(node)) {
		node.forEach((item) => buttons(item, found));
		return found;
	}
	if (node === null || node === undefined || typeof node !== 'object') {
		return found;
	}
	if (
		node.type === RecoveryBehaviourPanel ||
		node.type === AiResponseDelayPanel
	) {
		return found;
	}
	if (typeof node.type === 'function') {
		return buttons(node.type(node.props), found);
	}
	if (node.type === 'button') {
		found.push(node);
	}
	buttons(node.props?.children, found);
	return found;
}

describe('Woo Recovery Settings category presentation', () => {
	it('orders cards: summary, recovery controls, WhatsApp consent guidance, features, then store context', () => {
		const featurePreferencesState = {
			status: 'UNAVAILABLE',
			data: null,
		};
		const view = RecoverySettingsScreen({
			state: { status: 'IDLE', data: null },
			featurePreferencesState,
		});
		const children = view.props.children;
		expect(children[1].type).toBe(RecoveryBehaviourPanel);
		expect(children[2].type).toBe(AiResponseDelayPanel);
		expect(children[3].type).toBe(WhatsAppConsentGuidance);
		expect(children[3].props.featurePreferencesState).toBe(
			featurePreferencesState
		);
		expect(children[4].type).toBe(FeaturePreferencesPanel);
		expect(children[5].type).toBe(StoreAssistantContext);
		expect(children[5].props.storeProfile.type).toBe(StoreProfileAccordion);
		expect(children[5].props.merchantKnowledge.type).toBe(
			MerchantKnowledgePanel
		);
	});

	it('shows a bounded delay input and immediate-human guidance', () => {
		const fields = AiResponseDelayFields({
			value: '7',
			disabled: false,
			onChange: () => {},
		});
		const input = fields.props.children[0].props.children[1];
		expect(input.props).toMatchObject({ min: 0, max: 30, step: 1 });
		expect(flatten(fields)).toContain('AI response delay (minutes)');
		expect(flatten(fields)).toContain('Human replies are immediate.');
	});

	it('matches Shopify conceptual hierarchy with a separate navigation and explicit save', () => {
		const nav = RecoveryNavigation({
			selected: 'recovery',
			onSelect: () => {},
		});
		expect(flatten(nav)).toContain('Recovery Settings');
		const view = RecoverySettingsScreen({
			state: {
				status: 'READY',
				data: categoriesFixture(),
				categoryId: 'fashion',
				mappingIds: [],
			},
			onRefresh: () => {},
			onChoose: () => {},
			onToggleMapping: () => {},
			onSave: () => {},
		});
		for (const text of [
			'Store & assistant context',
			'Store category',
			'Fashion',
			'Save category',
			'Active category',
		]) {
			expect(flatten(view)).toContain(text);
		}
	});

	it('disables Save without selection and explains conflicts without silently saving', () => {
		const view = RecoverySettingsScreen({
			state: {
				status: 'CONFLICT',
				data: categoriesFixture(),
				categoryId: 'fashion',
				mappingIds: [],
			},
			onRefresh: () => {},
			onChoose: () => {},
			onToggleMapping: () => {},
			onSave: () => {},
		});
		expect(flatten(view)).toContain('Another administrator changed');
		expect(
			buttons(view).find((item) =>
				flatten(item).includes('Save category')
			).props.disabled
		).toBe(true);
	});
	it('offers retry after a verified failed Save without hiding the selected category', () => {
		const view = RecoverySettingsScreen({
			state: {
				status: 'SAVE_FAILED',
				data: categoriesFixture(),
				categoryId: 'fashion',
				mappingIds: [],
			},
			onRefresh: () => {},
			onChoose: () => {},
			onToggleMapping: () => {},
			onSave: () => {},
		});
		expect(flatten(view)).toContain('latest store settings do not show');
		expect(
			buttons(view).find((item) =>
				flatten(item).includes('Save category')
			).props.disabled
		).toBe(false);
	});

	it('requires Refresh when the result cannot be verified', () => {
		const view = RecoverySettingsScreen({
			state: {
				status: 'VERIFY_REQUIRED',
				data: categoriesFixture(),
				categoryId: 'fashion',
				mappingIds: [],
			},
			onRefresh: () => {},
			onChoose: () => {},
			onToggleMapping: () => {},
			onSave: () => {},
		});
		expect(flatten(view)).toContain('could not confirm whether');
		expect(
			buttons(view).find((item) =>
				flatten(item).includes('Save category')
			).props.disabled
		).toBe(true);
		expect(
			buttons(view).find((item) =>
				flatten(item).includes('Refresh categories')
			).props.disabled
		).toBe(false);
	});
});
