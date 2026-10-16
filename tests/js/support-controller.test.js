import { describe, expect, it, vi } from 'vitest';
import { SupportController } from '../../src/support/support-controller';
import { createSupportClient } from '../../src/support/support-client';
import { countSupportGraphemes, validSupportBody } from '../../src/support/support-validation';

const message = (id, kind = 'ADMINISTRATIVE') => ({
  id, kind, state: 'AVAILABLE', originalBody: 'Hi', displayBody: 'Bonjour',
  isTranslated: true, createdAt: '2026-10-16T10:00:00Z', readAt: null,
});
const fixtureClient = (overrides = {}) => ({
  capabilities: { read: true, send: true, markRead: true },
  list: vi.fn(async ({ page }) => ({ items: [message(`message-${page}`)], page, totalPages: 2 })),
  markRead: vi.fn(async () => true),
  send: vi.fn(async () => ({ sent: true })),
  ...overrides,
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Support controller and Woo transport boundary', () => {
  it('has no unapproved production support endpoints or synthetic messages', async () => {
    const client = createSupportClient();
    const controller = new SupportController(client);
    expect(client.capabilities).toEqual({ read: false, send: false, markRead: false });
    controller.setActive(true);
    expect(controller.state).toMatchObject({ status: 'UNAVAILABLE', items: [] });
    expect(await controller.refresh()).toBe(false);
    expect(await controller.send('Hello')).toBe(false);
    expect(controller.state.sendStatus).toBe('IDLE');
  });

  it('paginates real-shaped fixture results and marks only unread system/admin messages', async () => {
    const client = fixtureClient();
    const controller = new SupportController(client);
    controller.setActive(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.state.status).toBe('READY');
    expect(controller.state.items[0].readAt).not.toBeNull();
    await controller.goToPage(2);
    expect(controller.state.page).toBe(2);
    expect(client.list).toHaveBeenCalledWith({ page: 2, pageSize: 25 }, expect.anything());
    controller.goToPage(3);
    expect(client.list).toHaveBeenCalledTimes(2);
    controller.setActive(false);
    expect(controller.state.items).toEqual([]);
  });

  it('handles empty, malformed and failed reads without inventing success', async () => {
    const client = fixtureClient({
      list: vi.fn().mockResolvedValueOnce({ items: [], page: 1, totalPages: 0 })
        .mockResolvedValueOnce({ items: 'invalid', page: 1, totalPages: 1 })
        .mockRejectedValueOnce(new Error('offline')),
    });
    const controller = new SupportController(client);
    controller.setActive(true);
    await Promise.resolve();
    expect(controller.state).toMatchObject({ status: 'READY', items: [] });
    await controller.refresh();
    expect(controller.state.status).toBe('ERROR');
    await controller.refresh();
    expect(controller.state.status).toBe('ERROR');
    const denied = new SupportController(fixtureClient({ list: vi.fn().mockRejectedValue({ status: 403 }) }));
    denied.setActive(true);
    await Promise.resolve();
    expect(denied.state.status).toBe('DENIED');
    denied.setActive(false);
    controller.setActive(false);
  });

  it('discards superseded reads and responses after disconnect or rotation', async () => {
    const first = deferred();
    const second = deferred();
    const client = fixtureClient({ list: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
    const controller = new SupportController(client);
    controller.setActive(true);
    const abortSignal = client.list.mock.calls[0][1];
    const next = controller.refresh(2);
    expect(abortSignal.aborted).toBe(true);
    first.resolve({ items: [message('old')], page: 1, totalPages: 1 });
    await first.promise;
    expect(controller.state.status).toBe('LOADING');
    controller.setActive(false);
    second.resolve({ items: [message('new')], page: 2, totalPages: 2 });
    await next;
    expect(controller.state.items).toEqual([]);
    expect(controller.state.status).toBe('IDLE');
  });

  it('enforces a single submission and never claims success without service confirmation', async () => {
    const pending = deferred();
    const client = fixtureClient({ send: vi.fn(() => pending.promise) });
    const controller = new SupportController(client);
    controller.setActive(true);
    await Promise.resolve();
    expect(await controller.send('')).toBe(false);
    expect(controller.state.sendStatus).toBe('INVALID');
    const sending = controller.send('Hello');
    expect(controller.state.sendStatus).toBe('SENDING');
    expect(await controller.send('Hello')).toBe(false);
    expect(client.send).toHaveBeenCalledOnce();
    pending.resolve({ sent: false });
    expect(await sending).toBe(false);
    expect(controller.state.sendStatus).toBe('ERROR');
    controller.setActive(false);
  });

  it('counts grapheme clusters as Shopify does, including emoji and combining marks', () => {
    expect(countSupportGraphemes('👩‍💻e\u0301')).toBe(2);
    expect(validSupportBody('👩‍💻'.repeat(500))).toBe(true);
    expect(validSupportBody('👩‍💻'.repeat(501))).toBe(false);
    expect(validSupportBody('')).toBe(false);
  });
});
