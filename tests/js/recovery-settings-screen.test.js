import { describe, expect, it } from 'vitest';
import { RecoverySettingsScreen } from '../../src/recovery-settings/recovery-settings-screen';
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
});
