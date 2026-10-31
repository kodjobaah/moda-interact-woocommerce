/**
 * Redacted, test-only information about Woo Checkout Blocks hydration.
 * This must not accept arbitrary browser console text or checkout data.
 */
const permittedEvents = new Set([
	'blocks_script_loaded',
	'blocks_native_field_ready',
	'blocks_contact_changed',
	'blocks_http_started',
	'blocks_http_response',
	'blocks_http_rejected',
	'blocks_status_result',
	'blocks_status_failed',
	'blocks_choice_failed',
]);

const booleanSignals = [
	'consentScriptPresent',
	'configPresent',
	'wpDataPresent',
	'nativeCheckboxVisible',
];

function boundedCount(value) {
	return Number.isSafeInteger(value) && value >= 0
		? Math.min(value, 100)
		: 0;
}

/** Only enumerated event names are forwarded from Chromium's console. */
export function safeConsentBrowserEvent(prefix, event) {
	return prefix === '[Moda Woo Consent]' && permittedEvents.has(event)
		? event
		: null;
}

/** Never emit arbitrary page errors, network URLs, form values or DOM HTML. */
export function safeConsentBrowserSignals(runtime, events, pageErrorCount) {
	const summary = {};
	for (const key of booleanSignals) {
		summary[key] = runtime?.[key] === true;
	}
	summary.visibleConsentControls = boundedCount(runtime?.visibleConsentControls);
	summary.pageErrorCount = boundedCount(pageErrorCount);
	summary.registrationEvents = Array.from(
		new Set(events.filter((event) => permittedEvents.has(event)))
	).slice(0, 20);
	return summary;
}
