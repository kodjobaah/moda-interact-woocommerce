import { describe, expect, it } from 'vitest';
import { RecoveryEffectiveSummary } from '../../src/recovery-settings/recovery-effective-summary';

function flatten(node) {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}
	if (Array.isArray(node)) {
		return node.map(flatten).join(' ');
	}
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}
	if (typeof node.type === 'function') {
		return flatten(node.type(node.props));
	}
	return flatten(node.props?.children);
}

describe('Recovery Settings summary tiles', () => {
	it('uses effective values from the authenticated response', () => {
		const view = RecoveryEffectiveSummary({
			state: {
				status: 'READY',
				data: {
					recoveryDelayMinutes: 30,
					recoveryOfferMode: 'NONE',
					followUpEnabled: false,
					followUpDelayMinutes: null,
					source: 'MERCHANT',
				},
			},
		});
		expect(flatten(view)).toContain('Effective value: 30 minutes');
		expect(flatten(view)).toContain('Do not offer a discount');
		expect(flatten(view)).toContain('Effective follow-up: disabled');
	});

	it('does not pretend defaults when the read failed', () => {
		const view = RecoveryEffectiveSummary({
			state: { status: 'ERROR', data: null },
		});
		expect(flatten(view)).toContain('Unavailable');
		expect(flatten(view)).not.toContain('30 minutes');
	});
});
