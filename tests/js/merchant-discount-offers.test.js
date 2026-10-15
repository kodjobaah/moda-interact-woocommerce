import { describe, expect, it, vi } from 'vitest';
import { createMerchantOffersClient, parseCatalogue, parseOffers } from '../../src/recovery-settings/woo-coupons/offer-client';
import { MerchantOffersController } from '../../src/recovery-settings/woo-coupons/offer-controller';

const selected = ['coupon_1', 'coupon_3'];
const offers = (mode = 'FIXED', ids = selected) => ({
	schemaVersion: 1, revision: 'revision-1', merchant: { recoveryOfferMode: mode, selectedDiscountIds: ids },
	effective: { recoveryOfferMode: mode }, source: 'MERCHANT', overrideActive: false,
});
const row = (id, checked = false) => ({ id, title: id, summary: '10% off', providerType: 'WooCoupon:percent',
	code: id, startsAt: null, endsAt: null, selected: checked });
const first = { schemaVersion: 1, revision: 'revision-1', items: [row('coupon_1', true), row('coupon_2')],
	hasMore: true, nextCursor: 'coupon_2' };
const second = { schemaVersion: 1, revision: 'revision-1', items: [row('coupon_3', true), row('coupon_4')],
	hasMore: false, nextCursor: null };

function deferred() {
	let finish;
	const promise = new Promise((resolve) => { finish = resolve; });
	return { promise, finish };
}

describe('ARCH-036 Woo merchant offers', () => {
	it('accepts the API-002 contract but rejects forged shop/provider fields', () => {
		expect(parseOffers(offers()).merchant.selectedDiscountIds).toEqual(selected);
		expect(parseCatalogue(first).items).toHaveLength(2);
		expect(() => parseOffers({ ...offers(), shopId: 'foreign' })).toThrow();
		expect(() => parseCatalogue({ ...first, items: [{ ...first.items[0], credential: 'secret' }] })).toThrow();
	});

	it('uses only privileged WordPress endpoints and sends no CAS token', async () => {
		const fetcher = vi.fn(async ({ method, path }) => method === 'PUT' ? offers() :
			path.includes('discount-catalogue') ? first : offers());
		const client = createMerchantOffersClient(fetcher);
		await client.readOffers();
		await client.readCatalogue({ search: 'SAVE' });
		await client.saveOffers({ recoveryOfferMode: 'FIXED', selectedDiscountIds: selected });
		expect(fetcher.mock.calls[2][0]).toEqual({ method: 'PUT',
			path: '/moda-interact/v1/merchant/discount-offers',
			data: { recoveryOfferMode: 'FIXED', selectedDiscountIds: selected } });
		expect(fetcher.mock.calls[1][0].path).toContain('search=SAVE');
	});

	it('preserves a complete multi-page selected set and does not auto-save', async () => {
		const saveOffers = vi.fn(async (body) => offers(body.recoveryOfferMode, body.selectedDiscountIds));
		const readCatalogue = vi.fn(async ({ cursor }) => cursor ? second : first);
		const controller = new MerchantOffersController({ readOffers: async () => offers(), readCatalogue, saveOffers });
		await controller.refresh();
		expect(controller.state.selectedIds).toEqual(selected);
		await controller.next();
		controller.toggle('coupon_4');
		await controller.previous();
		controller.toggle('coupon_2');
		expect(controller.state.selectedIds).toEqual(['coupon_1', 'coupon_2', 'coupon_3', 'coupon_4']);
		expect(saveOffers).not.toHaveBeenCalled();
		await controller.save();
		expect(saveOffers).toHaveBeenCalledWith({ recoveryOfferMode: 'FIXED',
			selectedDiscountIds: ['coupon_1', 'coupon_2', 'coupon_3', 'coupon_4'] });
		controller.dispose();
	});

	it('blocks empty FIXED, prevents duplicate save and retains draft after 409', async () => {
		const gate = deferred();
		const saveOffers = vi.fn(() => gate.promise);
		const controller = new MerchantOffersController({ readOffers: async () => offers(),
			readCatalogue: async () => first, saveOffers });
		await controller.refresh();
		controller.toggle('coupon_1');
		controller.setMode('NONE');
		controller.setMode('FIXED');
		const before = controller.state.selectedIds;
		const a = controller.save(); const b = controller.save();
		expect(a).toBe(b);
		gate.finish(Promise.reject(new Error('OFFERS_CONFLICT')));
		await a;
		expect(saveOffers).toHaveBeenCalledTimes(1);
		expect(controller.state.error).toBe('OFFERS_CONFLICT');
		expect(controller.state.selectedIds).toEqual(before);
		controller.dispose();
	});

	it('does not allow controls to persist before the first successful Background sync', async () => {
		const saveOffers = vi.fn();
		const controller = new MerchantOffersController({ readOffers: async () => { throw new Error('CATALOGUE_NOT_CURRENT'); },
			readCatalogue: vi.fn(), saveOffers });
		await controller.refresh();
		expect(controller.state.status).toBe('NOT_READY');
		controller.setMode('AI_BEST_APPLICABLE');
		await controller.save();
		expect(saveOffers).not.toHaveBeenCalled();
		controller.dispose();
	});
});
