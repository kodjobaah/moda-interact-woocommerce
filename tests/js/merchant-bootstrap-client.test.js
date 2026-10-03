import { describe, expect, it, vi } from 'vitest';
import {
	createMerchantBootstrapClient,
	MERCHANT_BOOTSTRAP_PATH,
	parseMerchantBootstrap,
} from '../../src/merchant-bootstrap-client';

function bootstrap(overrides = {}) {
	return {
		schemaVersion: 1,
		shop: {
			id: 'shop_123',
			platform: 'WOOCOMMERCE',
			domain: 'https://merchant.example',
			onboardingCompleted: false,
			installedAt: '2026-10-03T12:00:00.000Z',
		},
		internationalContext: {
			storeLocale: 'pt_BR',
			languageTag: null,
			timeZone: 'Europe/Lisbon',
			countryCode: 'PT',
		},
		storeProfile: {
			activeCategory: null,
			pendingCategory: {
				id: 'category_1',
				slug: 'apparel',
				displayName: 'Apparel',
			},
			pendingSelectionGeneration: 3,
			pendingSelectedAt: '2026-10-02T12:30:00Z',
		},
		...overrides,
	};
}

describe('merchant bootstrap client', () => {
	it('calls only the local route and preserves provider locale independently from language tag', async () => {
		const request = vi.fn().mockResolvedValue(bootstrap());
		const client = createMerchantBootstrapClient(request);
		const result = await client.getMerchantBootstrap();

		expect(request).toHaveBeenCalledWith({
			path: MERCHANT_BOOTSTRAP_PATH,
			method: 'GET',
		});
		expect(result.internationalContext.storeLocale).toBe('pt_BR');
		expect(result.internationalContext.languageTag).toBeNull();
		expect(result.storeProfile.pendingCategory.displayName).toBe('Apparel');
	});

	it('accepts an untranslated provider-native locale without manufacturing a language tag', () => {
		const payload = bootstrap();
		payload.internationalContext.storeLocale = 'zz_ZZ';
		payload.internationalContext.languageTag = null;

		const result = parseMerchantBootstrap(payload);
		expect(result.internationalContext.storeLocale).toBe('zz_ZZ');
		expect(result.internationalContext.languageTag).toBeNull();
	});

	it('preserves the normalized language tag independently from provider locale', () => {
		const payload = bootstrap();
		payload.internationalContext.languageTag = 'pt-BR';

		const result = parseMerchantBootstrap(payload);
		expect(result.internationalContext.storeLocale).toBe('pt_BR');
		expect(result.internationalContext.languageTag).toBe('pt-BR');
	});

	it.each([
		[{ ...bootstrap(), schemaVersion: 2 }],
		[{ ...bootstrap(), secret: 'must-not-pass' }],
		[
			bootstrap({
				internationalContext: {
					storeLocale: 'pt_BR',
					languageTag: null,
					timeZone: null,
					countryCode: null,
				},
			}),
		],
	])(
		'rejects unknown schema and malformed extra/date-bearing data',
		(payload) => {
			if (payload.schemaVersion === 1) {
				payload.shop.installedAt = '2026-02-30T12:00:00Z';
			}
			expect(() => parseMerchantBootstrap(payload)).toThrow(
				'REMOTE_RESPONSE_INVALID'
			);
		}
	);

	it('normalizes only bounded local error codes and hides arbitrary response details', async () => {
		const client = createMerchantBootstrapClient(
			vi.fn().mockRejectedValue({
				error: 'RECONNECT_REQUIRED',
				message: 'private remote detail',
			})
		);
		await expect(client.getMerchantBootstrap()).rejects.toThrow(
			'RECONNECT_REQUIRED'
		);
		const malformedClient = createMerchantBootstrapClient(
			vi.fn().mockRejectedValue({
				error: 'private remote detail',
			})
		);
		await expect(malformedClient.getMerchantBootstrap()).rejects.toThrow(
			'LOAD_FAILED'
		);
	});
});
