import { describe, expect, it, vi } from 'vitest';
import { ReadAccessPanel } from '../../src/read-access/read-access-panel';

function contents(node) {
	if (node == null || typeof node === 'boolean') return '';
	if (Array.isArray(node)) return node.map(contents).join(' ');
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	return contents(node.props?.children);
}
function find(node, predicate) {
	if (!node || typeof node !== 'object') return null;
	if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
	if (predicate(node)) return node;
	return find(node.props?.children, predicate);
}
const state = (grantStatus, authorizationUrl = null) => ({
	status: 'READY', grantStatus, pendingAction: null,
	providerRevocationRequired: false, authorizationUrl,
});
const callbacks = () => ({ onStart: vi.fn(), onRefresh: vi.fn(), onRevoke: vi.fn() });

describe('WooCommerce read-access card', () => {
	it('offers read-only consent without requiring it for Moda connection', () => {
		const ui = ReadAccessPanel({ state: state('NOT_CONNECTED'), ...callbacks() });
		expect(contents(ui)).toContain('read-only access');
		expect(contents(ui)).toContain('Allow read access');
		expect(ui.props['aria-labelledby']).toBe('moda-interact-read-access-title');
	});

	it('shows incomplete consent rather than claiming success', () => {
		const ui = ReadAccessPanel({ state: { ...state('NOT_CONNECTED'), approvalNotCompleted: true }, ...callbacks() });
		expect(contents(ui)).toContain('Approval was not completed or has expired');
	});

	it('lets a merchant resume consent after returning without the ephemeral link', () => {
		const ui = ReadAccessPanel({ state: state('PENDING'), ...callbacks() });
		expect(contents(ui)).toContain('Allow read access');
	});

	it('shows only the native Woo approval URL in an isolated new tab', () => {
		const url = 'https://woo.example/wc-auth/v1/authorize?scope=read';
		const ui = ReadAccessPanel({ state: state('PENDING', url), ...callbacks() });
		const link = find(ui, (node) => node.type === 'a');
		expect(link.props.href).toBe(url);
		expect(link.props.target).toBe('_blank');
		expect(link.props.rel).toBe('noopener noreferrer');
		expect(link.props.referrerPolicy).toBe('no-referrer');
		expect(contents(ui)).not.toContain('Read access approved');
	});

	it('requires confirmation to disconnect and tells merchant how to revoke provider key', () => {
		const onRevoke = vi.fn();
		const prev = globalThis.confirm;
		globalThis.confirm = vi.fn(() => false);
		try {
			const ui = ReadAccessPanel({ state: state('CONNECTED'), ...callbacks(), onRevoke });
			find(ui, (node) => node.type === 'button' && contents(node) === 'Stop read access').props.onClick();
			expect(onRevoke).not.toHaveBeenCalled();
			globalThis.confirm.mockReturnValue(true);
			find(ui, (node) => node.type === 'button' && contents(node) === 'Stop read access').props.onClick();
			expect(onRevoke).toHaveBeenCalledTimes(1);
			const revoked = ReadAccessPanel({ state: { ...state('REAUTHORIZATION_REQUIRED'), providerRevocationRequired: true }, ...callbacks() });
			expect(contents(revoked)).toContain('WooCommerce > Settings > Advanced > REST API');
		} finally {
			globalThis.confirm = prev;
		}
	});
});
