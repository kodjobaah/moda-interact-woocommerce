import { describe, expect, it, vi } from 'vitest';
import { FeaturePreferencesPanel } from '../../src/recovery-settings/feature-preferences-panel';

function nodes(view, type) {
	if (view == null || typeof view !== 'object') return [];
	if (Array.isArray(view)) return view.flatMap((node) => nodes(node, type));
	return [
		...(view.type === type ? [view] : []),
		...nodes(view.props?.children, type),
	];
}

function text(view) {
	if (view == null) return '';
	if (Array.isArray(view)) return view.map(text).join(' ');
	if (typeof view !== 'object') return String(view);
	return text(view.props?.children);
}

const makeView = (state, onToggle = vi.fn(), onRefresh = vi.fn()) =>
	FeaturePreferencesPanel({ state, onRefresh, onToggle });

const fixture = {
	revision: 'one',
	features: [
		{ id: 'core', key: 'test_core', name: 'Core fixture', description: 'Required feature', editable: false, enabled: false, effective: true },
		{ id: 'opt', key: 'test_opt', name: 'Optional fixture', description: 'Test description', editable: true, enabled: false, effective: false },
	],
};

describe('WooCommerce Conversation features Shopify parity', () => {
	it('uses the canonical heading, description and required/optional card semantics', () => {
		const onToggle = vi.fn();
		const view = makeView({ status: 'READY', data: fixture }, onToggle);
		expect(view.props.id).toBe('conversation-features');
		expect(nodes(view, 'h2')[0].props.children).toBe('Conversation features');
		expect(text(view)).toContain('changes apply to new conversations only');
		expect(text(view)).toContain('Core fixture');
		expect(text(view)).toContain('Always enabled');
		expect(text(view)).toContain('Currently enabled');
		expect(text(view)).toContain('Optional fixture');
		expect(text(view)).toContain('Currently disabled');
		expect(nodes(view, 'label')).toHaveLength(1);
		expect(nodes(view, 'input')).toHaveLength(1);
		expect(nodes(view, 'input')[0].props.checked).toBe(false);
		nodes(view, 'input')[0].props.onChange({ target: { checked: true } });
		expect(onToggle).toHaveBeenCalledWith('opt', true);
		// Shopify does not display a permanent Refresh button below the cards.
		expect(nodes(view, 'button')).toHaveLength(0);
	});

	it.each([
		['LOADING', 'Loading…', true],
		['UNAVAILABLE', 'not yet available', false],
		['DENIED', 'permission', false],
		['ERROR', 'could not be loaded', false],
		['CONFLICT', 'changed elsewhere', false],
	])('shows %s with truthful status and no fabricated cards', (status, message, busy) => {
		const view = makeView({ status, data: null });
		expect(text(view)).toContain(message);
		expect(nodes(view, 'input')).toHaveLength(0);
		expect(view.props['aria-busy']).toBe(busy);
		expect(nodes(view, 'button')).toHaveLength(busy ? 0 : 1);
	});

	it('shows empty and saving states without optimistic changes', () => {
		expect(text(makeView({ status: 'READY', data: { revision: 'r', features: [] } }))).toContain('No eligible features');
		const view = makeView({ status: 'SAVING', data: fixture });
		expect(nodes(view, 'input')[0].props.disabled).toBe(true);
		expect(nodes(view, 'input')[0].props.checked).toBe(false);
		expect(nodes(view, 'button')).toHaveLength(0);
	});
});
