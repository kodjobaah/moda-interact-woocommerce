import { describe, expect, it, vi } from 'vitest';
import {
	RECOVERY_SUMMARY_PATH,
	createRecoverySummaryClient,
	parseRecoverySummary,
} from '../../src/recovery-summary-client';

const summary = {
	schemaVersion: 1,
	recoveryDelayMinutes: 30,
	recoveryOfferMode: 'NONE',
	followUpEnabled: false,
	followUpDelayMinutes: null,
	source: 'MERCHANT',
};

describe('Woo effective recovery summary API client', () => {
	it('reads the privileged local endpoint without transmitting an installation secret or shop ID', async () => {
		const request = vi.fn().mockResolvedValue(summary);
		expect(await createRecoverySummaryClient(request).read()).toEqual(
			summary
		);
		expect(request).toHaveBeenCalledWith({
			path: RECOVERY_SUMMARY_PATH,
			method: 'GET',
		});
	});

	it('rejects unknown keys and impossible follow-up states', () => {
		expect(() =>
			parseRecoverySummary({ ...summary, credential: 'no' })
		).toThrow();
		expect(() =>
			parseRecoverySummary({ ...summary, followUpEnabled: true })
		).toThrow();
		expect(() =>
			parseRecoverySummary({ ...summary, recoveryDelayMinutes: -1 })
		).toThrow();
	});

	it('allows bounded active override values', () => {
		expect(
			parseRecoverySummary({
				...summary,
				followUpEnabled: true,
				followUpDelayMinutes: 120,
				source: 'ADMIN_OVERRIDE',
			}).source
		).toBe('ADMIN_OVERRIDE');
	});
});
