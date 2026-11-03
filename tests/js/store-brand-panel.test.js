import { describe, expect, it, vi } from 'vitest';
import { StoreBrandPanel } from '../../src/recovery-settings/store-brand-panel';

function flatten(node) {
	if (node === null || node === undefined || typeof node === 'boolean') return '';
	if (Array.isArray(node)) return node.map(flatten).join(' ');
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (typeof node.type === 'function') return flatten(node.type(node.props));
	return flatten(node.props?.children);
}

function find(node, predicate, found = []) {
	if (Array.isArray(node)) { node.forEach((item) => find(item, predicate, found)); return found; }
	if (!node || typeof node !== 'object') return found;
	if (typeof node.type === 'function') return find(node.type(node.props), predicate, found);
	if (predicate(node)) found.push(node);
	find(node.props?.children, predicate, found);
	return found;
}

describe('Store branding panel', () => {
	it('explains the native WordPress workflow and preserves truthful acceptance wording', () => {
		const view = StoreBrandPanel({ state: { status: 'READY', data: { status: 'ACCEPTED', lastAcceptedAt: '2026-10-27T09:01:00Z' } }, onRefresh: vi.fn(), onSync: vi.fn() });
		expect(flatten(view)).toContain('Store branding');
		expect(flatten(view)).toContain('Site Name, Site Logo and Site Icon');
		expect(flatten(view)).toContain('Moda accepted these brand details');
		expect(flatten(view)).toContain('Background image processing may still be pending');
		expect(flatten(view)).not.toContain('Your branding is synchronised');
	});

	it('disables sync while queued or busy and exposes terminal failure feedback with retry', () => {
		const queued = StoreBrandPanel({ state: { status: 'READY', data: { status: 'QUEUED', lastAcceptedAt: null } }, onRefresh: vi.fn(), onSync: vi.fn() });
		const syncButton = find(queued, (element) => element.type === 'button' && flatten(element).includes('Sync branding'))[0];
		expect(syncButton.props.disabled).toBe(true);
		expect(flatten(queued)).toContain('has not accepted it yet');
		const failed = StoreBrandPanel({ state: { status: 'READY', data: { status: 'FAILED', lastAcceptedAt: '2026-10-27T09:01:00Z' } }, onRefresh: vi.fn(), onSync: vi.fn() });
		expect(find(failed, (element) => element.props?.role === 'alert')).toHaveLength(1);
		expect(find(failed, (element) => element.type === 'button' && flatten(element).includes('Sync branding'))[0].props.disabled).toBe(false);
		expect(flatten(failed)).toContain('Last synchronised');
	});
});
