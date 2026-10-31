// WooCommerce's native Additional Checkout Fields API owns the checkbox DOM.
// This bridge observes deliberate shopper actions only. Woo's stored field value
// is never proof of consent: the authenticated Moda Cart Store API is authority.
(function () {
	'use strict';

	const config = window.modaWooCheckoutConsentConfig;
	const wp = window.wp;
	const blocks = window.wc?.blocksCheckout;
	const doc = window.document;
	const fieldSelector = 'input[data-moda-consent-control="1"]';
	if (!config || !doc || !wp?.data?.select || !blocks?.extensionCartUpdate) {
		return; // Optional extension must never interrupt checkout.
	}

	let debugEnabled = false;
	try {
		debugEnabled = window.sessionStorage?.getItem('modaWooConsentDebug') === '1';
	} catch {
		// Browser storage restrictions must never affect checkout.
	}
	function debug(event) {
		if (!debugEnabled) return;
		try {
			window.console?.info?.('[Moda Woo Consent]', event);
		} catch {
			// DevTools are optional.
		}
	}
	debug('blocks_script_loaded');

	let contact = '';
	let generation = 0;
	let verified = false;
	// Last deliberate checkbox choice is presentation-only. Backend consent
	// remains unchanged unless an authenticated operation is acknowledged.
	let localChoice = null;
	let checking = false;
	let pendingIds = { GRANT: null, REVOKE: null };
	let actions = [];
	let sending = false;
	let grantAttempted = false;
	let counter = 0;
	let refreshTimer;
	let reconcileTimer;

	function currentContact() {
		try {
			const cart = wp.data.select('wc/store/cart')?.getCartData?.();
			const billing = cart?.billingAddress || {};
			return `${billing.country || ''}|${billing.phone || ''}`;
		} catch {
			return '|';
		}
	}

	function render() {
		const field = doc.querySelector(fieldSelector);
		if (!field) return;
		// Woo can recreate the native input after an API/cart update. Reapply
		// the customer's choice, never the result of a failed network request.
		// Property writes do not generate a new consent action.
		field.checked = localChoice === null ? verified : localChoice;
		field.disabled = false;
		field.setAttribute('aria-busy', 'false');
	}

	function scheduleRender() {
		if (reconcileTimer !== undefined) return;
		reconcileTimer = window.setTimeout(() => {
			reconcileTimer = undefined;
			try {
				render();
			} catch {
				debug('blocks_native_field_sync_failed');
			}
		}, 0);
	}

	async function request(action, payload, contactSnapshot, stableId = null) {
		const separator = contactSnapshot.indexOf('|');
		const requestId =
			stableId || `moda-${Date.now().toString(36)}-${++counter}`;
		let timeout;
		debug('blocks_http_started');
		try {
			const update = blocks.extensionCartUpdate({
				namespace: 'moda-interact-consent',
				overwriteDirtyCustomerData: false,
				data: {
					...payload,
					action,
					requestId,
					expectedPhone: contactSnapshot.slice(separator + 1),
					expectedCountry: contactSnapshot.slice(0, separator),
				},
			});
			await Promise.race([
				update,
				new Promise((_, reject) => {
					timeout = window.setTimeout(
						() => reject(new Error('consent_timeout')),
						4000
					);
				}),
			]);
			const result = wp.data.select('wc/store/cart')?.getCartData?.()
				?.extensions?.['moda-interact-consent'];
			if (result?.requestId !== requestId) {
				throw new Error('consent_ack_unavailable');
			}
			debug('blocks_http_response');
			return result;
		} catch {
			debug('blocks_http_rejected');
			throw new Error('consent_request_unavailable');
		} finally {
			if (timeout !== undefined) window.clearTimeout?.(timeout);
		}
	}

	// Process deliberate transitions in order. A second click is never blocked
	// by an in-flight request, and a stale response cannot rewrite the UI.
	async function drainActions() {
		if (sending) return;
		sending = true;
		try {
			while (actions.length) {
				const action = actions.shift();
				if (action.generation !== generation || action.contact !== contact) {
					continue;
				}
				const { decision, requestId, contact: at, generation: id } = action;
				try {
					const result = await request(
						decision === 'GRANT' ? 'choice' : 'withdraw',
						decision === 'GRANT'
							? { mode: 'BLOCKS', checked: true }
							: { mode: 'BLOCKS', confirmed: true },
						at,
						requestId
					);
					if (id !== generation || at !== contact) continue;
					if (result.status !== 'recorded') {
						debug('blocks_choice_failed');
						continue;
					}
					if (pendingIds[decision] === requestId) {
						pendingIds[decision] = null;
					}
					if (decision === 'REVOKE') {
						verified = false;
						grantAttempted = false;
					} else {
						// GRANT ACK cannot override STOP. The read only updates
						// verified state; it never overrides the local checkbox.
						try {
							const status = await request(
								'status',
								{ mode: 'BLOCKS' },
								at
							);
							if (id === generation && at === contact) {
								verified = status.confirmed === true;
							}
						} catch {
							debug('blocks_status_failed');
						}
					}
				} catch {
					// Failed/ambiguous commands do not change verified consent.
					// The latest customer selection remains displayed.
					debug('blocks_choice_failed');
				} finally {
					if (id === generation) {
						render();
					}
				}
			}
		} finally {
			sending = false;
			render();
		}
	}

	function onChange(event) {
		const field = event.target;
		if (!field?.matches?.(fieldSelector) || event.isTrusted !== true) {
			return;
		}
		// Allow Woo's native checkbox interaction. Woo's stored field is
		// display-only and is never authoritative consent evidence.
		localChoice = field.checked === true;
		render();
		const at = contact;
		if (!at.split('|')[1]) {
			return;
		}
		const decision = localChoice ? 'GRANT' : 'REVOKE';
		// A failed REVOKE does not erase the server's existing grant; a
		// subsequent check needs no duplicate GRANT. Conversely, an uncheck
		// of a never-granted choice does not invent a withdrawal.
		if (!sending && !actions.length) {
			if (decision === 'GRANT' && verified) {
				return;
			}
			if (decision === 'REVOKE' && !verified && !grantAttempted) {
				return;
			}
		}
		const requestId =
			(!sending && !actions.length && pendingIds[decision]) ||
			`moda-${Date.now().toString(36)}-${++counter}`;
		pendingIds[decision] = requestId;
		if (decision === 'GRANT') {
			grantAttempted = true;
		}
		actions.push({ decision, requestId, generation, contact: at });
		void drainActions();
	}

	function observeContact() {
		const next = currentContact();
		if (next === contact) {
			scheduleRender();
			return;
		}
		contact = next;
		const id = ++generation;
		verified = false;
		localChoice = null;
		checking = !!next.split('|')[1];
		pendingIds = { GRANT: null, REVOKE: null };
		grantAttempted = false;
		actions = [];
		window.clearTimeout?.(refreshTimer);
		scheduleRender();
		debug('blocks_contact_changed');
		if (!checking) return;
		// Billing edits debounce before a proof-backed read. There is no
		// staged choice and no automatic GRANT on a phone change.
		refreshTimer = window.setTimeout(async () => {
			try {
				const result = await request('status', { mode: 'BLOCKS' }, next);
				if (id === generation && next === contact) {
					verified = result.confirmed === true;
					debug('blocks_status_result');
				}
			} catch {
				if (id === generation) {
					verified = false;
					debug('blocks_status_failed');
				}
			} finally {
				if (id === generation) {
					checking = false;
					render();
				}
			}
		}, 450);
	}

	// Subscriptions and DOM observation never publish consent; they only
	// reconcile the native checkbox after Woo re-renders its own form.
	doc.addEventListener('change', onChange, true);
	try {
		wp.data.subscribe(observeContact);
	} catch {
		debug('blocks_cart_subscription_unavailable');
	}
	try {
		const observer = new window.MutationObserver(scheduleRender);
		observer.observe(doc.documentElement, { childList: true, subtree: true });
	} catch {
		debug('blocks_native_observer_unavailable');
	}
	if (doc.readyState === 'loading') {
		doc.addEventListener('DOMContentLoaded', observeContact, { once: true });
	} else {
		observeContact();
	}
	debug('blocks_native_field_ready');
})();
