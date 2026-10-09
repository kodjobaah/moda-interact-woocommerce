import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RecoverySettingsHeader } from '../../src/recovery-settings/recovery-settings-header';
import { CategoryProfileSummary } from '../../src/recovery-settings/category-profile-summary';
import { RecoverySettingsScreen } from '../../src/recovery-settings/recovery-settings-screen';
import { categoriesFixture } from './store-category-fixtures';

function walk(node, visitor) {
	if (Array.isArray(node)) {
		node.forEach((child) => walk(child, visitor));
		return;
	}
	if (!node || typeof node !== 'object') {
		return;
	}
	if (typeof node.type === 'function') {
		walk(node.type(node.props), visitor);
		return;
	}
	visitor(node);
	walk(node.props?.children, visitor);
}

function all(node, tag) {
	const found = [];
	walk(node, (element) => {
		if (element.type === tag) {
			found.push(element);
		}
	});
	return found;
}

describe('Shopify-inspired Recovery Settings presentation', () => {
	it('keeps the accessible heading and groups profile labels with their values', () => {
		const heading = RecoverySettingsHeader({
			summaryState: { status: 'IDLE', data: null },
			onRefreshSummary: () => {},
		});
		expect(all(heading, 'h2')[0].props.id).toBe(
			'moda-interact-recovery-heading'
		);

		const profile = categoriesFixture().storeProfile;
		const summary = CategoryProfileSummary({ profile });
		const list = all(summary, 'dl')[0];
		expect(list.props.className).toBe(
			'moda-interact-recovery__profile-grid'
		);
		expect(all(summary, 'dt')).toHaveLength(4);
		expect(all(summary, 'dd')).toHaveLength(4);
	});

	it('retains explicit Save and the native details disclosure', () => {
		const save = () => {};
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
			onSave: save,
		});
		expect(all(view, 'details')).toHaveLength(1);
		expect(
			all(view, 'button').find((button) => button.props.onClick === save)
		).toBeDefined();
	});

	it('scopes the theme to the Moda page rather than all WordPress Admin', () => {
		const source = readFileSync(
			new URL('../../src/styles/_tokens.scss', import.meta.url),
			'utf8'
		);
		expect(source).toContain('.moda-interact-page {');
		expect(source).not.toMatch(/^:root\s*\{/m);
	});
});
