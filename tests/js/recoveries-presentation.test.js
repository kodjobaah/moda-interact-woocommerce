import { describe, expect, it } from 'vitest';
import {
	recoveryDisplayRows,
	recoveryPaginationLabel,
	recoveryRangeLabel,
} from '../../src/recoveries/recoveries-presentation';

const data = {
	timeZone: 'Europe/London',
	from: '2026-10-01',
	to: '2026-10-11',
	page: 2,
	totalPages: 3,
	items: [
		{
			id: 'rec_1',
			detectedAt: '2026-10-10T12:00:00.000Z',
			status: 'ENGAGED',
			totalPrice: '89.99',
			currency: 'GBP',
			customer: {
				displayName: 'Ada Lovelace',
				email: 'ada@example.invalid',
			},
		},
	],
};

describe('Recoveries merchant UI projection', () => {
	it('formats store-local dates and currency without adding customer data', () => {
		const row = recoveryDisplayRows(data, 'en-GB')[0];
		expect(row.customerName).toBe('Ada Lovelace');
		expect(row.checkoutValue).toContain('89.99');
		expect(row.startedAt).toContain('13:00'); // London is UTC+1 on 10 October.
		expect(row.status).toBe('ENGAGED');
		expect(recoveryRangeLabel(data, 'en-GB')).toContain('Oct');
		expect(recoveryPaginationLabel(data, 'en-GB')).toContain('2');
	});

	it('never manufactures an amount if price/currency is absent or overflows', () => {
		const unknown = recoveryDisplayRows(
			{
				...data,
				items: [
					{ ...data.items[0], totalPrice: null, currency: null },
					{ ...data.items[0], totalPrice: '9'.repeat(40) },
				],
			},
			'en-GB'
		);
		expect(
			unknown.every((row) => row.checkoutValue === 'Unavailable')
		).toBe(true);
	});
});
