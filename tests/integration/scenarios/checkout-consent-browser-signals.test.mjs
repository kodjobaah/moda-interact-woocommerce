import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	safeConsentBrowserEvent,
	safeConsentBrowserSignals,
} from './checkout-consent-browser-signals.mjs';

test('native Blocks diagnostics contain only fixed, approved event names', () => {
	assert.equal(
		safeConsentBrowserEvent('[Moda Woo Consent]', 'blocks_native_field_ready'),
		'blocks_native_field_ready'
	);
	assert.equal(safeConsentBrowserEvent('[Moda Woo Consent]', 'phone=+447400123456'), null);
	assert.equal(safeConsentBrowserEvent('Other', 'blocks_status_failed'), null);
});

test('missing native checkout field reports bounded flags without customer data', () => {
	const signals = safeConsentBrowserSignals(
		{ consentScriptPresent: true, configPresent: true, wpDataPresent: true,
			nativeCheckboxVisible: false, visibleConsentControls: 0,
			phone: '+447400123456', token: 'private-token' },
		['blocks_script_loaded', 'blocks_native_field_ready', 'phone=+447400123456'],
		3
	);
	assert.equal(signals.nativeCheckboxVisible, false);
	assert.equal(signals.visibleConsentControls, 0);
	assert.deepEqual(signals.registrationEvents, ['blocks_script_loaded', 'blocks_native_field_ready']);
	assert.equal(signals.pageErrorCount, 3);
	assert.doesNotMatch(JSON.stringify(signals), /447400123456|private-token/);
});
