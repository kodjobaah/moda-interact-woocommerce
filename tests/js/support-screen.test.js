import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SupportThread } from '../../src/support/support-thread';
import { SupportMessageCard, supportSystemHref } from '../../src/support/support-message-card';
import { SupportComposer } from '../../src/support/support-composer';

function find(node, type) {
  if (Array.isArray(node)) return node.flatMap((item) => find(item, type));
  if (!node || typeof node !== 'object') return [];
  return [ ...(node.type === type ? [node] : []), ...find(node.props?.children, type) ];
}
function words(node) {
  if (Array.isArray(node)) return node.map(words).join(' ');
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return words(node.props?.children);
}
const state = (status, items = [], page = 1, totalPages = 1) =>
  ({ status, items, page, totalPages, sendStatus: 'IDLE' });

describe('Support native merchant presentation', () => {
  it('shows explicit unavailable state with disabled refresh and page buttons', () => {
    const view = SupportThread({ state: state('UNAVAILABLE'), canRead: false });
    expect(words(view)).toContain('not yet available');
    expect(words(view)).not.toContain('No messages yet');
    expect(find(view, 'button').every((button) => button.props.disabled)).toBe(true);
  });

  it('shows distinct loading, empty and failed-read states', () => {
    const descriptions = [
      ['LOADING', 'Loading'],
      ['READY', 'No messages yet'],
      ['ERROR', 'could not be loaded'],
      ['DENIED', 'do not have permission'],
    ];
    for (const [status, content] of descriptions) {
      expect(words(SupportThread({ state: state(status), canRead: true }))).toContain(content);
    }
    expect(find(SupportThread({ state: state('ERROR'), canRead: true }), 'button'))
      .toHaveLength(4); // refresh, retry, previous, next
  });

  it('renders ordered, server-paginated messages without allowing unsupported navigation', () => {
    const page = vi.fn();
    const item = { id: 'fixture', kind: 'SYSTEM', state: 'AVAILABLE',
      originalBody: 'Hello', displayBody: 'Bonjour', createdAt: '2026-10-16T10:00:00Z' };
    const view = SupportThread({ state: state('READY', [item], 2, 3), canRead: true, onPage: page });
    const cards = find(view, SupportMessageCard);
    expect(cards).toHaveLength(1);
    expect(cards[0].props.message).toBe(item);
    expect(words(view)).toContain('Page 2 of 3');
    const buttons = find(view, 'button');
    buttons[1].props.onClick();
    buttons[2].props.onClick();
    expect(page.mock.calls).toEqual([[1], [3]]);
  });

  it('never inserts untrusted system URLs into a support card action', () => {
    expect(supportSystemHref({ kind: 'SYSTEM', systemCode: 'BILLING_PLAN_UPGRADED' }))
      .toBe('admin.php?page=moda-interact-billing');
    expect(supportSystemHref({ kind: 'SYSTEM', systemCode: 'https://bad.invalid' }))
      .toBeNull();
    expect(supportSystemHref({ kind: 'MERCHANT', systemCode: 'BILLING_PLAN_UPGRADED' }))
      .toBeNull();
  });

  it('keeps a disabled composer in production and mobile/keyboard styles scoped', () => {
    expect(SupportComposer).toBeTypeOf('function');
    const client = readFileSync(new URL('../../src/support/support-client.js', import.meta.url), 'utf8');
    expect(client).toMatch(/read: false, send: false, markRead: false/);
    const css = readFileSync(new URL('../../src/support/styles/_support.scss', import.meta.url), 'utf8');
    expect(css).toContain('@media (max-width: 600px)');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('.moda-interact-page .moda-support');
  });
});
