import { describe, it, expect, vi } from 'vitest';
import {
	createFeaturePreferencesClient,
	parseFeaturePreferences,
	FEATURE_PREFERENCES_PATH,
} from '../../src/recovery-settings/feature-preferences-client';

const projection = () => ({
	schemaVersion: 1,
	revision: 'a'.repeat(64),
	features: [
		{
			id: 'core_1',
			key: 'recovery',
			name: 'Recovery',
			description: null,
			enabled: true,
			effective: true,
			editable: false,
			required: true,
			planEligible: true,
		},
		{
			id: 'option_1',
			key: 'merchant_knowledge',
			name: 'Merchant knowledge',
			description: null,
			enabled: false,
			effective: false,
			editable: true,
			required: false,
			planEligible: true,
		},
	],
});

describe('ARCH-035-WOOCOMMERCE-015 live feature preferences', () => {
	it('reads strict effective versus optional state using same-origin WordPress', async () => {
		const request = vi.fn(async () => projection());
		const client = createFeaturePreferencesClient(request);
		const data = await client.read();
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				path: FEATURE_PREFERENCES_PATH,
				method: 'GET',
			})
		);
		expect(data.features[0].effective).toBe(true);
		expect(data.features[1].editable).toBe(true);
		expect(data.features[1].enabled).toBe(false);
	});

	it('submits the exact CAS changes shape, not the obsolete preferences shape', async () => {
		const request = vi.fn(async () => projection());
		await createFeaturePreferencesClient(request).save({
			expectedRevision: 'a'.repeat(64),
			changes: [{ featureId: 'option_1', enabled: true }],
		});
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				path: FEATURE_PREFERENCES_PATH,
				method: 'PUT',
				data: {
					expectedRevision: 'a'.repeat(64),
					changes: [{ featureId: 'option_1', enabled: true }],
				},
			})
		);
	});

	it('rejects invalid entitlement and missing version before presentation', () => {
		for (const invalid of [
			{ ...projection(), schemaVersion: 2 },
			{ ...projection(), credential: 'bad' },
			{ ...projection(), revision: 'stale' },
			{
				...projection(),
				features: [
					{ ...projection().features[0], planEligible: false },
				],
			},
			{
				...projection(),
				features: [{ ...projection().features[1], required: true }],
			},
		]) {
			expect(() => parseFeaturePreferences(invalid)).toThrow(
				'FEATURES_INVALID'
			);
		}
	});

	it.each([
		[401, 'RECONNECT_REQUIRED'],
		[403, 'DENIED'],
		[409, 'CONFLICT'],
		[503, 'FEATURES_UNAVAILABLE'],
	])(
		'maps broker HTTP %s without leaking upstream details',
		async (status, code) => {
			const request = vi.fn(async () => {
				throw { status, secret: 'do-not-log' };
			});
			await expect(
				createFeaturePreferencesClient(request).read()
			).rejects.toMatchObject({ code });
		}
	);
});
