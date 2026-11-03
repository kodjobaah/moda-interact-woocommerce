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
	function debug(event, details = {}) {
		if (!debugEnabled) return;
		try {
			const safe = {};
			for (const key of ['action', 'decision', 'stage', 'status']) {
				if (['status', 'choice', 'withdraw', 'GRANT', 'REVOKE', 'transport',
					'acknowledgement', 'verification', 'recorded', 'unverified',
					'granted', 'neutral'].includes(details[key])) {
					safe[key] = details[key];
				}
			}
			if (typeof details.confirmed === 'boolean') {
				safe.confirmed = details.confirmed;
			}
			if (Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599) {
				safe.httpStatus = details.httpStatus;
			}
			window.console?.info?.('[Moda Woo Consent]', event, safe);
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
	// A deliberate choice made before the shopper supplied a phone has no
	// recipient binding yet. Preserve its presentation through initial billing
	// entry, but do not turn that UI choice into a deferred GRANT. Once a status
	// read establishes the contact, a later phone change clears that choice.
	let choiceContact = null;
	let checking = false;
	let pendingIds = { GRANT: null, REVOKE: null };
	let actions = [];
	let sending = false;
	// An attempted GRANT is not proof of an acknowledged grant. Distinguish
	// definite pre-publication rejection from an ambiguous lost acknowledgement.
	let grantState = 'NONE';
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

	// An explicit pre-publication rejection cannot have created a new grant.
	// Other errors, including an ACK lost after a possible write, are ambiguous;
	// an uncheck in that case still needs the protected server withdrawal path.
	const prePublicationRejections = new Set([
		'store_api_expected_phone_invalid',
		'store_api_expected_phone_unparseable',
		'store_api_expected_country_invalid',
		'store_api_session_unavailable',
		'store_api_customer_unavailable',
		'store_api_server_phone_invalid',
		'store_api_billing_phone_mismatch',
		'store_api_choice_value_invalid',
		'capture_observe_unverified_context',
		'capture_observe_invalid_mode',
		'capture_observe_session_unavailable',
		'capture_observe_cart_unavailable',
		'capture_observe_cart_invalid',
		'capture_observe_cart_empty',
		'capture_observe_checkout_key_unavailable',
		'capture_observe_phone_missing',
		'capture_observe_phone_invalid',
		'capture_observe_session_identity_unavailable',
		'capture_observe_context_change_requires_neutral',
		'capture_observe_phone_change_requires_neutral',
		'capture_observe_neutral_selection_required',
		'capture_observe_neutral_selection_observed',
		'capture_observe_store_choice_history_full',
		'capture_observe_feature_ineligible',
		'capture_observe_grant_timestamp_unavailable',
	]);

	function diagnosticError(error, action, stage) {
		return { action, stage, httpStatus: error?.status ?? error?.data?.status };
	}

	async function request(action, payload, contactSnapshot, stableId = null) {
		const separator = contactSnapshot.indexOf('|');
		const requestId =
			stableId || `moda-${Date.now().toString(36)}-${++counter}`;
		let timeout;
		let unsubscribe;
		let resolveAcknowledgement;
		let acknowledgement = null;
		let stage = 'transport';
		const acknowledgementPromise = new Promise((resolve) => {
			resolveAcknowledgement = resolve;
		});
		const captureAcknowledgement = () => {
			try {
				const result = wp.data.select('wc/store/cart')?.getCartData?.()
					?.extensions?.['moda-interact-consent'];
				if (!acknowledgement && result?.requestId === requestId) {
					// Copy the complete, fixed-shape action response before another
					// Woo checkout/cart refresh replaces it with status: idle.
					acknowledgement = {
						requestId: result.requestId,
						status: result.status,
						confirmed: result.confirmed === true,
						reason: result.reason,
					};
					resolveAcknowledgement(acknowledgement);
				}
			} catch {
				// A partially hydrated cart is not an acknowledgement.
			}
		};
		debug('blocks_http_started', { action });
		try {
			// Subscribe BEFORE issuing the request. The cart-store response may
			// appear only briefly, or after extensionCartUpdate resolves.
			if (typeof wp.data.subscribe === 'function') {
				unsubscribe = wp.data.subscribe(captureAcknowledgement);
			}
			const deadline = new Promise((_, reject) => {
				timeout = window.setTimeout(() => reject(
					new Error(stage === 'transport'
						? 'consent_transport_timeout' : 'consent_ack_timeout')
				), 4000);
			});
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
			await Promise.race([update, deadline]);
			stage = 'acknowledgement';
			captureAcknowledgement();
			const result = acknowledgement ||
				await Promise.race([acknowledgementPromise, deadline]);
			debug('blocks_http_response', {
				action,
				status: result.status,
				confirmed: result.confirmed,
				reason: typeof result.reason === 'string' &&
					/^[a-zA-Z0-9_-]{0,128}$/.test(result.reason)
						? result.reason : null,
			});
			return result;
		} catch (error) {
			debug('blocks_http_rejected', diagnosticError(error, action, stage));
			// Do not replace the original SDK/network exception with a generic
			// consent_request_unavailable: the reason matters during development.
			throw error;
		} finally {
			if (typeof unsubscribe === 'function') unsubscribe();
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
					// Do not invent a REVOKE when the preceding GRANT was
					// definitively rejected before any publication. Ambiguous
					// writes still require the proof-checked withdrawal path.
					if (decision === 'REVOKE' && !verified && grantState === 'REJECTED') {
						if (pendingIds.REVOKE === requestId) pendingIds.REVOKE = null;
						grantState = 'NONE';
						debug('blocks_withdraw_skipped_no_grant');
						continue;
					}
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
						if (decision === 'GRANT') {
							grantState = prePublicationRejections.has(result.reason)
								? 'REJECTED' : 'AMBIGUOUS';
						}
						debug('blocks_choice_failed', {
							decision,
							status: result.status,
							reason: typeof result.reason === 'string' ? result.reason : null,
						});
						continue;
					}
					if (pendingIds[decision] === requestId) {
						pendingIds[decision] = null;
					}
					if (decision === 'REVOKE') {
						verified = false;
						grantState = 'NONE';
					} else {
						grantState = 'ACKNOWLEDGED';
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
						} catch (error) {
							debug('blocks_status_failed', diagnosticError(error, 'status', 'verification'));
						}
					}
				} catch (error) {
					// The hosted GRANT may have succeeded even if the response was
					// lost; a later uncheck must still attempt protected withdrawal.
					if (decision === 'GRANT') grantState = 'AMBIGUOUS';
					// Failed/ambiguous commands do not change verified consent.
					// The latest customer selection remains displayed.
					debug('blocks_choice_failed', diagnosticError(error,
						decision === 'GRANT' ? 'choice' : 'withdraw', 'action'));
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
		const checked = field.checked === true;
		// The native input may blur the billing field immediately before its
		// change event. Do not use a stale contact from the last subscription.
		if (currentContact() !== contact) observeContact();
		localChoice = checked;
		choiceContact = contact.split('|')[1] ? contact : null;
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
			if (decision === 'GRANT' && (verified || grantState === 'ACKNOWLEDGED')) {
				return;
			}
			if (decision === 'REVOKE' && !verified && grantState === 'NONE') {
				return;
			}
		}
		const requestId =
			(!sending && !actions.length && pendingIds[decision]) ||
			`moda-${Date.now().toString(36)}-${++counter}`;
		pendingIds[decision] = requestId;
		if (decision === 'GRANT') {
			grantState = 'PENDING';
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
		// Never transfer a choice bound to an existing phone to a different
		// recipient. An unbound choice made with no phone may remain visible
		// during first contact entry, but is not itself a consent command.
		if (choiceContact !== null && choiceContact !== next) {
			localChoice = null;
			choiceContact = null;
		}
		checking = !!next.split('|')[1];
		pendingIds = { GRANT: null, REVOKE: null };
		grantState = 'NONE';
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
			} catch (error) {
				if (id === generation) {
					verified = false;
					debug('blocks_status_failed', diagnosticError(error, 'status', 'verification'));
				}
			} finally {
				if (id === generation && next === contact) {
					// Once the first contact has settled, bind the local *visual*
					// choice so a subsequent phone change clears it, even if the
					// status service was unavailable. This never publishes consent.
					if (localChoice !== null && choiceContact === null) {
						choiceContact = next;
					}
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
