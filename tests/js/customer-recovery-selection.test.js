import { describe, expect, it, vi } from 'vitest';
import {
	isCanonicalPhone, isTicketReference, makeSelectionCommand,
	parseSelectionStatus, SELECTION_PATH,
} from '../../src/recoveries/customer-selection/selection-contract';
import { createSelectionClient } from '../../src/recoveries/customer-selection/selection-client';
import { SelectionController } from '../../src/recoveries/customer-selection/selection-controller';

const PHONE = '447400123477';
const status = (reason = null, consentDecision = 'GRANTED', revision = '0') => ({
	schemaVersion: 'woo.customer-recovery-selection.v1',
	consentDecision,
	suppressed: reason !== null,
	suppressionReason: reason,
	noContactRevision: revision,
	phoneEligibleForRecovery: reason === null && consentDecision === 'GRANTED',
	canReenable: reason === 'MERCHANT_OPT_OUT' && consentDecision === 'GRANTED',
});

const nextMicrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ARCH-046-WOOCOMMERCE-007 contract and privileged client', () => {
	it('requires one canonical phone and an opaque STOP ticket, never arbitrary consent grants', () => {
		expect(isCanonicalPhone(PHONE)).toBe(true);
		for (const phone of ['+447400123477', '00447400123477', '447 400123477', '1', '', PHONE + '123456']) {
			expect(isCanonicalPhone(phone)).toBe(false);
		}
		expect(isTicketReference('case-123_ABC')).toBe(true);
		expect(isTicketReference('customer@example.org')).toBe(false);
		const command = makeSelectionCommand(status(), PHONE, 'SUPPRESS', null);
		expect(Object.keys(command).sort()).toEqual([
			'action', 'canonicalPhone', 'evidenceReference', 'expectedNoContactRevision', 'schemaVersion',
		]);
		expect(command).not.toHaveProperty('shopId');
		expect(command).not.toHaveProperty('customerId');
		expect(() => makeSelectionCommand(status(), PHONE, 'GRANT', null)).toThrow('INVALID_REQUEST');
		expect(() => makeSelectionCommand(status(), PHONE, 'RECORD_CUSTOMER_STOP', null)).toThrow('INVALID_REQUEST');
	});

	it('rejects invalid or PII-bearing hosted responses', () => {
		expect(parseSelectionStatus(status())).toEqual(status());
		expect(() => parseSelectionStatus({ ...status(), customerPhone: PHONE })).toThrow('REMOTE_RESPONSE_INVALID');
		expect(() => parseSelectionStatus({ ...status(), suppressed: true })).toThrow('REMOTE_RESPONSE_INVALID');
		expect(() => parseSelectionStatus({ ...status(), canReenable: true })).toThrow('REMOTE_RESPONSE_INVALID');
		expect(() => parseSelectionStatus({ ...status(), outcome: 'updated' })).toThrow('REMOTE_RESPONSE_INVALID');
		expect(parseSelectionStatus({ ...status(), outcome: 'duplicate' }, true).outcome).toBe('duplicate');
	});

	it('uses only WordPress REST endpoints, without browser installation credentials', async () => {
		const request = vi.fn(async (options) => options.method === 'GET'
			? status() : { ...status('MERCHANT_OPT_OUT', 'GRANTED', '1'), outcome: 'updated' });
		const client = createSelectionClient(request);
		const signal = new AbortController().signal;
		const current = await client.lookup(PHONE, signal);
		const next = await client.execute(current, PHONE, 'SUPPRESS', null, signal);
		expect(next.suppressionReason).toBe('MERCHANT_OPT_OUT');
		expect(request.mock.calls).toEqual([
			[{ path: `${SELECTION_PATH}?canonicalPhone=${PHONE}`, method: 'GET', signal }],
			[{ path: SELECTION_PATH, method: 'POST', data: makeSelectionCommand(current, PHONE, 'SUPPRESS', null), signal }],
		]);
		for (const [options] of request.mock.calls) {
			expect(options).not.toHaveProperty('headers');
			expect(options).not.toHaveProperty('Authorization');
		}
	});
});

describe('ARCH-046 merchant selection controller', () => {
	it('serializes double clicks and never retries a conflicting write', async () => {
		let finish;
		const client = {
			lookup: vi.fn(async () => status()),
			execute: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
		};
		const controller = new SelectionController(client);
		controller.setActive(true);
		await controller.lookup(PHONE);
		const first = controller.command('SUPPRESS');
		expect(controller.state.phase).toBe('SAVING');
		expect(await controller.command('SUPPRESS')).toBe(false);
		expect(client.execute).toHaveBeenCalledTimes(1);
		finish({ ...status('MERCHANT_OPT_OUT', 'GRANTED', '1'), outcome: 'updated' });
		await first;
		expect(controller.state.record.canReenable).toBe(true);
		expect(controller.state.record.noContactRevision).toBe('1');
	});

	it('blocks re-enable unless hosted status says currently GRANTED and merchant-suppressed', async () => {
		const client = { lookup: vi.fn(async () => status('MERCHANT_OPT_OUT', 'UNKNOWN', '2')),
			execute: vi.fn(async () => status()) };
		const controller = new SelectionController(client);
		controller.setActive(true);
		await controller.lookup(PHONE);
		expect(await controller.command('REENABLE')).toBe(false);
		expect(client.execute).not.toHaveBeenCalled();
	});

	it('requires STOP ticket and keeps STOP terminal even when merchant controls remain', async () => {
		const client = { lookup: vi.fn(async () => status()),
			execute: vi.fn(async () => ({ ...status('CUSTOMER_STOP', 'GRANTED', '1'), outcome: 'updated' })) };
		const controller = new SelectionController(client);
		controller.setActive(true);
		await controller.lookup(PHONE);
		expect(await controller.command('RECORD_CUSTOMER_STOP', null)).toBe(false);
		expect(await controller.command('RECORD_CUSTOMER_STOP', 'ticket_12')).toBe(true);
		expect(controller.state.record.suppressionReason).toBe('CUSTOMER_STOP');
		expect(await controller.command('REENABLE')).toBe(false);
		expect(await controller.command('RECORD_CUSTOMER_STOP', 'ticket_13')).toBe(false);
		expect(client.execute).toHaveBeenCalledTimes(1);
	});

	it('fails closed on stale revision, requiring another explicit lookup', async () => {
		const client = { lookup: vi.fn(async () => status()),
			execute: vi.fn(async () => { throw new Error('STALE_NO_CONTACT_REVISION'); }) };
		const controller = new SelectionController(client);
		controller.setActive(true);
		await controller.lookup(PHONE);
		expect(await controller.command('SUPPRESS')).toBe(false);
		expect(controller.state.phase).toBe('ERROR');
		expect(controller.state.record).toBe(null);
		expect(await controller.command('SUPPRESS')).toBe(false);
		expect(client.execute).toHaveBeenCalledTimes(1);
	});

	it('ignores a late response after leaving the merchant screen', async () => {
		let finish;
		const controller = new SelectionController({
			lookup: () => new Promise((resolve) => { finish = resolve; }), execute: vi.fn(),
		});
		controller.setActive(true);
		const operation = controller.lookup(PHONE);
		controller.setActive(false);
		finish(status());
		await operation;
		await nextMicrotask();
		expect(controller.state.phase).toBe('IDLE');
		expect(controller.state.phone).toBe(null);
	});
});
