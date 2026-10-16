import { describe, expect, it, vi } from 'vitest';
import {
	createMerchantOffersClient,
	parseCatalogue,
	parseOffers,
} from '../../src/recovery-settings/woo-coupons/offer-client';
import { MerchantOffersController } from '../../src/recovery-settings/woo-coupons/offer-controller';

const selected = ['coupon_1', 'coupon_3'];
const offers = (mode = 'FIXED', ids = selected) => ({
	schemaVersion: 1,
	revision: 'revision-1',
	merchant: { recoveryOfferMode: mode, selectedDiscountIds: ids },
	effective: { recoveryOfferMode: mode },
	source: 'MERCHANT',
	overrideActive: false,
});
const row = (id, checked = false) => ({
	id,
	title: id,
	summary: '10% off',
	providerType: 'WooCoupon:percent',
	code: id,
	startsAt: null,
	endsAt: null,
	selected: checked,
});
const first = {
	schemaVersion: 1,
	revision: 'revision-1',
	items: [row('coupon_1', true), row('coupon_2')],
	hasMore: true,
	nextCursor: 'coupon_2',
};
const second = {
	schemaVersion: 1,
	revision: 'revision-1',
	items: [row('coupon_3', true), row('coupon_4')],
	hasMore: false,
	nextCursor: null,
};

function deferred() {
	let finish;
	const promise = new Promise((resolve) => {
		finish = resolve;
	});
	return { promise, finish };
}

describe('ARCH-036 Woo merchant offers', () => {
	it('accepts the API-002 contract but rejects forged shop/provider fields', () => {
		expect(parseOffers(offers()).merchant.selectedDiscountIds).toEqual(
			selected
		);
		expect(parseCatalogue(first).items).toHaveLength(2);
		expect(() => parseOffers({ ...offers(), shopId: 'foreign' })).toThrow();
		expect(() =>
			parseCatalogue({
				...first,
				items: [{ ...first.items[0], credential: 'secret' }],
			})
		).toThrow();
	});

	it('accepts unknown types, expired/zero metadata and complete >255-character codes', () => {
		const longCode = 'Z'.repeat(4096);
		const rows = [row('coupon_5'), row('coupon_6'), row('coupon_7')].map((item, i) => ({
			...item,
			providerType: ['WooCoupon:plugin_custom', 'WooCoupon:fixed_cart', 'WooCoupon:percent'][i],
			code: i === 0 ? longCode : item.code,
			title: i === 0 ? longCode : item.title,
			summary: ['0', 'expired', 'usage limit reached'][i],
			endsAt: i === 1 ? '2025-01-01T00:00:00.000Z' : null,
		}));
		expect(parseCatalogue({ ...first, items: rows, hasMore: false, nextCursor: null }).items).toEqual(rows);
	});

	it('uses only privileged WordPress endpoints and sends no CAS token', async () => {
		const fetcher = vi.fn(async ({ method, path }) =>
			method === 'PUT'
				? offers()
				: path.includes('discount-catalogue')
					? first
					: offers()
		);
		const client = createMerchantOffersClient(fetcher);
		await client.readOffers();
		await client.readCatalogue({ search: 'SAVE' });
		await client.saveOffers({
			recoveryOfferMode: 'FIXED',
			selectedDiscountIds: selected,
		});
		expect(fetcher.mock.calls[2][0]).toEqual({
			method: 'PUT',
			path: '/moda-interact/v1/merchant/discount-offers',
			data: { recoveryOfferMode: 'FIXED', selectedDiscountIds: selected },
		});
		expect(fetcher.mock.calls[1][0].path).toContain('search=SAVE');
	});

	it('preserves a complete multi-page selected set and does not auto-save', async () => {
		const saveOffers = vi.fn(async (body) =>
			offers(body.recoveryOfferMode, body.selectedDiscountIds)
		);
		const readCatalogue = vi.fn(async ({ cursor }) =>
			cursor ? second : first
		);
		const controller = new MerchantOffersController({
			readOffers: async () => offers(),
			readCatalogue,
			saveOffers,
		});
		await controller.refresh();
		await vi.waitFor(() => expect(controller.state.catalogueStatus).toBe('READY'));
		expect(controller.state.selectedIds).toEqual(selected);
		await controller.next();
		controller.toggle('coupon_4');
		await controller.previous();
		controller.toggle('coupon_2');
		expect(controller.state.selectedIds).toEqual([
			'coupon_1',
			'coupon_2',
			'coupon_3',
			'coupon_4',
		]);
		expect(saveOffers).not.toHaveBeenCalled();
		await controller.save();
		expect(saveOffers).toHaveBeenCalledWith({
			recoveryOfferMode: 'FIXED',
			selectedDiscountIds: [
				'coupon_1',
				'coupon_2',
				'coupon_3',
				'coupon_4',
			],
		});
		controller.dispose();
	});

	it('blocks empty FIXED, prevents duplicate save and retains draft after 409', async () => {
		const gate = deferred();
		const saveOffers = vi.fn(() => gate.promise);
		const controller = new MerchantOffersController({
			readOffers: async () => offers(),
			readCatalogue: async () => first,
			saveOffers,
		});
		await controller.refresh();
		await vi.waitFor(() => expect(controller.state.catalogueStatus).toBe('READY'));
		controller.toggle('coupon_1');
		controller.setMode('NONE');
		controller.setMode('FIXED');
		const before = controller.state.selectedIds;
		const a = controller.save();
		const b = controller.save();
		expect(a).toBe(b);
		gate.finish(Promise.reject(new Error('OFFERS_CONFLICT')));
		await a;
		expect(saveOffers).toHaveBeenCalledTimes(1);
		expect(controller.state.error).toBe('OFFERS_CONFLICT');
		expect(controller.state.selectedIds).toEqual(before);
		controller.dispose();
	});

	it('loads NONE without reading a catalogue and saves AI even when coupon fetch would fail', async () => {
		const readCatalogue = vi.fn(async () => { throw new Error('CATALOGUE_NOT_CURRENT'); });
		const saveOffers = vi.fn(async (draft) => offers(draft.recoveryOfferMode, draft.selectedDiscountIds));
		const controller = new MerchantOffersController({
			readOffers: async () => offers('NONE', []), readCatalogue, saveOffers,
		});
		await controller.refresh();
		expect(controller.state.status).toBe('READY');
		expect(controller.state.catalogueStatus).toBe('IDLE');
		expect(readCatalogue).not.toHaveBeenCalled();
		controller.setMode('AI_BEST_APPLICABLE');
		expect(controller.isDirty()).toBe(true);
		await controller.save();
		expect(saveOffers).toHaveBeenCalledWith({
			recoveryOfferMode: 'AI_BEST_APPLICABLE', selectedDiscountIds: [],
		});
		expect(readCatalogue).not.toHaveBeenCalled();
		controller.dispose();
	});

	it('does not erase FIXED preferences when catalogue is not current; NONE remains savable', async () => {
		const readCatalogue = vi.fn(async () => { throw new Error('CATALOGUE_NOT_CURRENT'); });
		const saveOffers = vi.fn(async (draft) => offers(draft.recoveryOfferMode, draft.selectedDiscountIds));
		const controller = new MerchantOffersController({ readOffers: async () => offers(), readCatalogue, saveOffers });
		await controller.refresh();
		await vi.waitFor(() => expect(controller.state.catalogueStatus).toBe('NOT_READY'));
		expect(controller.state.status).toBe('READY');
		expect(controller.state.selectedIds).toEqual(selected);
		controller.setMode('NONE');
		await controller.save();
		expect(saveOffers).toHaveBeenCalledWith({ recoveryOfferMode: 'NONE', selectedDiscountIds: selected });
		controller.dispose();
	});

	it('allows a FIXED retry without discarding draft and blocks duplicate catalogue requests', async () => {
		const gate = deferred();
		let calls = 0;
		const readCatalogue = vi.fn(() => ++calls === 1
			? Promise.reject(new Error('CATALOGUE_NOT_CURRENT')) : gate.promise);
		const saveOffers = vi.fn();
		const controller = new MerchantOffersController({
			readOffers: async () => offers('NONE', []), readCatalogue, saveOffers,
		});
		await controller.refresh();
		controller.setMode('FIXED');
		await vi.waitFor(() => expect(controller.state.catalogueStatus).toBe('NOT_READY'));
		expect(controller.state.mode).toBe('FIXED');
		const retry = controller.retryCoupons();
		await controller.retryCoupons();
		expect(readCatalogue).toHaveBeenCalledTimes(2);
		gate.finish({ ...first, items: [], hasMore: false, nextCursor: null });
		await retry;
		expect(controller.state.catalogueStatus).toBe('READY');
		expect(controller.state.page.items).toEqual([]);
		await controller.save();
		expect(saveOffers).not.toHaveBeenCalled();
		controller.setMode('NONE');
		expect(controller.isDirty()).toBe(false);
		controller.dispose();
	});

	it('keeps saved selected IDs across a catalogue failure, mode changes and Discard', async () => {
		const controller = new MerchantOffersController({
			readOffers: async () => offers(),
			readCatalogue: async () => { throw new Error('CATALOGUE_NOT_CURRENT'); },
			saveOffers: vi.fn(),
		});
		await controller.refresh();
		await vi.waitFor(() => expect(controller.state.catalogueStatus).toBe('NOT_READY'));
		controller.setMode('NONE');
		expect(controller.isDirty()).toBe(true);
		controller.cancel();
		expect(controller.state.mode).toBe('FIXED');
		expect(controller.state.selectedIds).toEqual(selected);
		expect(controller.isDirty()).toBe(false);
		controller.dispose();
	});
});
