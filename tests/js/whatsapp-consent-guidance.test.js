import { describe, expect, it } from 'vitest';
import { WhatsAppConsentGuidance } from '../../src/recovery-settings/whatsapp-consent-guidance';

function text(node) {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}
	if (Array.isArray(node)) {
		return node.map(text).join(' ');
	}
	if (typeof node !== 'object') {
		return String(node);
	}
	if (typeof node.type === 'function') {
		return text(node.type(node.props));
	}
	return text(node.props?.children);
}

describe('Woo WhatsApp Recovery Settings disclosure', () => {
	it('states purpose, optional default, verification and withdrawal without a consent-source selector', () => {
		const view = WhatsAppConsentGuidance();
		const copy = text(view);
		expect(view.props['aria-labelledby']).toBe(
			'moda-interact-woo-whatsapp-consent-title'
		);
		expect(copy).toContain('WhatsApp marketing');
		expect(copy).toContain('unfinished checkouts');
		expect(copy).toContain('unchecked');
		expect(copy).toContain('explicit choice');
		expect(copy).toContain('Without verified permission');
		expect(copy).toContain('withdraw consent');
		expect(copy).not.toContain('Consent source');
	});
});
