import { readFileSync } from 'node:fs';
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

function locateClassNode(node, className) {
	if (!node || typeof node !== 'object') {
		return undefined;
	}
	if (Array.isArray(node)) {
		return node
			.map((child) => locateClassNode(child, className))
			.find(Boolean);
	}
	if (node.props?.className?.split(' ').includes(className)) {
		return node;
	}
	return locateClassNode(node.props?.children, className);
}

describe('Woo WhatsApp Recovery Settings disclosure', () => {
	it('explains automatic setup and verified consent', () => {
		const view = WhatsAppConsentGuidance();
		const copy = text(view);
		expect(view.props['aria-labelledby']).toBe(
			'moda-interact-woo-whatsapp-consent-title'
		);
		expect(copy).toContain('automatically adds');
		expect(copy).toContain('No manual installation');
		expect(copy).toContain('Classic: after billing phone');
		expect(copy).toContain('Blocks: under Order Information');
		expect(copy).toContain('unchecked');
		expect(copy).toContain('verified customer choice');
		expect(copy).toContain('withdraw');
		expect(copy).not.toContain('Consent source');
		expect(
			locateClassNode(view, 'moda-interact-recovery__body')
		).toBeTruthy();
	});

	it('shows confirmed feature status without claiming checkout installation', () => {
		const feature = {
			key: 'checkout_recovery',
			name: 'Checkout Recovery',
			effective: true,
		};
		const state = { status: 'READY', data: { features: [feature] } };
		const ready = WhatsAppConsentGuidance({
			featurePreferencesState: state,
		});
		expect(
			text(locateClassNode(ready, 'moda-interact-woo-consent__feature'))
		).toContain('Currently enabled');

		const disabled = WhatsAppConsentGuidance({
			featurePreferencesState: {
				status: 'SAVED',
				data: { features: [{ ...feature, effective: false }] },
			},
		});
		expect(text(disabled)).toContain('Currently disabled');

		const loading = WhatsAppConsentGuidance({
			featurePreferencesState: { ...state, status: 'LOADING' },
		});
		expect(
			locateClassNode(loading, 'moda-interact-woo-consent__feature')
		).toBeUndefined();
	});

	it('provides padded text containment', () => {
		const stylesheet = readFileSync(
			new URL('../../src/styles/_recovery.scss', import.meta.url),
			'utf8'
		);
		expect(stylesheet).toContain(
			'.moda-interact-woo-consent .moda-interact-recovery__body'
		);
		expect(stylesheet).toMatch(
			/\.moda-interact-woo-consent__note\s*\{[^}]*padding:\s*12px 14px/s
		);
		expect(stylesheet).toMatch(
			/\.moda-interact-woo-consent__intro\s*\{[^}]*overflow-wrap:\s*anywhere/s
		);
	});
});
