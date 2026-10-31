/* global jQuery */
// Classic checkout owns the form and the authenticated update lifecycle.
(function ($) {
	'use strict';
	let debugEnabled = false;
	try {
		debugEnabled =
			window.sessionStorage?.getItem('modaWooConsentDebug') === '1';
	} catch {
		// Restricted session storage disables diagnostics, not consent.
	}
	function debug(event, details = {}) {
		if (!debugEnabled || typeof window.console?.info !== 'function') {
			return;
		}
		try {
			window.console.info('[Moda Woo Consent]', event, details);
		} catch {
			// Console failures must not affect checkout.
		}
	}
	debug('classic_script_loaded', { jqueryPresent: !!$ });
	if (!$) {
		return;
	}
	const choice = 'input[name="moda_interact_whatsapp_recovery_opt_in"]';
	const checkAction = 'moda_interact_whatsapp_recovery_checked_action';
	const config = window.modaWooCheckoutConsentConfig;
	debug('classic_config', { configPresent: !!config });
	let serial = 0;
	let timer;
	let lastContact = null;
	let pendingChange = false;
	let withdrawalPending = false;
	let withdrawalRetryRequested = false;
	let grantedForContact = false;
	let localChoice = null;
	let grantAttemptedForContact = false;

	function form() {
		return $('form.checkout').first();
	}
	function contactKey(checkout) {
		const phone = checkout.find('input[name="billing_phone"]').val() || '';
		const country = checkout.find('[name="billing_country"]').val() || '';
		return `${country}|${phone}`;
	}
	function setView(state) {
		if (state !== 'checking') {
			grantedForContact = state === 'granted';
			// A checked action is one deliberate request, not a marker for later
			// checkout updates or a failed status lookup.
			form().find(`input[name="${checkAction}"]`).remove();
		}
		debug('classic_view', { state });
		// A remote status or write failure must never undo a shopper's click.
		// Checked is *not* proof of a persisted GRANT; that remains server-owned.
		$(choice).prop(
			'checked',
			localChoice === null ? grantedForContact : localChoice
		);
		$(choice).prop('disabled', false);
	}

	async function request(path, body) {
		debug('classic_http_started', { action: path });
		const endpoint =
			path === 'status' ? config.statusEndpoint : config.withdrawEndpoint;
		if (!endpoint || !config.nonce) {
			throw new Error('consent_endpoint_unavailable');
		}
		// Never hold a checkout interaction open indefinitely for Moda's status API.
		const controller =
			typeof window.AbortController === 'function'
				? new window.AbortController()
				: null;
		const timeout =
			controller && typeof window.setTimeout === 'function'
				? window.setTimeout(() => controller.abort(), 3500)
				: null;
		let result;
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					security: config.nonce,
					mode: body.mode,
					form: body.form,
					...(path === 'withdraw'
						? { confirmed: body.confirmed === true ? '1' : '0' }
						: {}),
				}).toString(),
				cache: 'no-store',
				...(controller ? { signal: controller.signal } : {}),
			});
			debug('classic_http_response', {
				action: path,
				ok: response.ok === true,
				httpStatus: Number.isInteger(response.status)
					? response.status
					: null,
			});
			if (!response.ok) {
				debug('classic_http_rejected', {
					action: path,
					errorCode: 'http_rejected',
				});
				throw new Error('consent_request_unavailable');
			}
			result = await response.json();
		} finally {
			if (timeout !== null) {
				window.clearTimeout?.(timeout);
			}
		}
		return result;
	}

	async function refresh(force = false) {
		if (!config || !form().length || !$(choice).length) {
			return;
		}
		const checkout = form();
		const contact = contactKey(checkout);
		if (!force && contact === lastContact) {
			return;
		}
		if (contact !== lastContact) {
			// A changed phone or country cannot inherit an earlier choice.
			localChoice = null;
			grantedForContact = false;
			grantAttemptedForContact = false;
		}
		lastContact = contact;
		const id = ++serial;
		if (!contact.slice(contact.indexOf('|') + 1)) {
			setView('neutral');
			return;
		}
		setView('checking');
		try {
			const result = await request('status', {
				mode: 'CLASSIC',
				form: checkout.serialize(),
			});
			if (id !== serial || contact !== contactKey(form())) {
				return;
			}
			debug('classic_status_result', {
				confirmed: result.confirmed === true,
				reason:
					result.reason === 'consent_proof_missing'
						? 'consent_proof_missing'
						: null,
			});
			setView(result.confirmed === true ? 'granted' : 'neutral');
		} catch {
			if (id === serial) {
				debug('classic_status_failed');
				setView('neutral');
			}
		}
	}

	function scheduleRefresh(force = false) {
		serial++;
		clearTimeout(timer);
		timer = setTimeout(() => refresh(force), 450);
	}

	function stageGrant() {
		const checkout = form();
		if (!checkout.length) {
			return;
		}
		checkout.find(`input[name="${checkAction}"]`).remove();
		$('<input>', {
			type: 'hidden',
			name: checkAction,
			value: '1',
		}).appendTo(checkout);
		grantAttemptedForContact = true;
		pendingChange = true;
		$(document.body).trigger('update_checkout');
	}

	// Only an explicit, customer-generated uncheck calls this endpoint. The
	// server independently requires the current Woo session and a verified proof.
	// Failed/ambiguous requests leave server consent unchanged as far as the
	// client can establish; they never revert the customer's checkbox.
	async function revokeFromCheckbox() {
		if (!config || !form().length) {
			return;
		}
		if (withdrawalPending) {
			withdrawalRetryRequested = true;
			return;
		}
		const checkout = form();
		const contact = contactKey(checkout);
		if (contact !== lastContact) {
			scheduleRefresh(true);
			return;
		}
		withdrawalPending = true;
		try {
			const result = await request('withdraw', {
				mode: 'CLASSIC',
				confirmed: true,
				form: checkout.serialize(),
			});
			if (result.status !== 'withdrawn') {
				throw new Error('consent_ack_unavailable');
			}
			if (contact === contactKey(form())) {
				// Invalidate any earlier status read racing this withdrawal.
				serial++;
				grantedForContact = false;
				grantAttemptedForContact = false;
				// If the shopper checked again while REVOKE was pending, the
				// latest deliberate GRANT follows the completed withdrawal.
				if (localChoice === true) {
					stageGrant();
				}
			}
			debug('classic_withdraw_ack');
		} catch {
			// No rollback of the visual choice; no storefront warning.
			debug('classic_withdraw_failed');
		} finally {
			withdrawalPending = false;
			const retry = withdrawalRetryRequested;
			withdrawalRetryRequested = false;
			if (retry && contact === contactKey(form()) && localChoice === false) {
				void revokeFromCheckbox();
			}
			setView('checking');
		}
	}


	$(document.body).on('change', choice, function (event) {
		// Never infer consent from Woo's programmatic form hydration.
		if (event && event.originalEvent?.isTrusted !== true) {
			return;
		}
		const current = contactKey(form());
		if (current !== lastContact) {
			// Never apply old-recipient status or proof to a new phone.
			lastContact = current;
			serial++;
			grantedForContact = false;
			grantAttemptedForContact = false;
		}
		// A late status response cannot remove the staged checked-action marker
		// before WooCommerce has submitted this deliberate choice.
		serial++;
		localChoice = this.checked === true;
		debug('classic_checkbox_changed', { checked: localChoice });
		const checkout = $(this).closest('form.checkout');
		if (checkout.length) {
			checkout.find(`input[name="${checkAction}"]`).remove();
			checkout
				.find(
					'input[name="moda_interact_whatsapp_recovery_unchecked_action"]'
				)
				.remove();
		}
		if (localChoice) {
			// No new GRANT is needed when the existing verified consent
			// remains unchanged after a failed withdrawal.
			if (!grantedForContact && !withdrawalPending) {
				stageGrant();
			}
		} else {
			// A deliberate uncheck may follow an in-flight Classic GRANT.
			// Always send an explicit proof-checked withdrawal in that case.
			if (grantedForContact || grantAttemptedForContact) {
				void revokeFromCheckbox();
			}
			pendingChange = true;
			$(document.body).trigger('update_checkout');
		}
	});

	if (config) {
		$(document.body).on('updated_checkout', () => {
			const changed = pendingChange;
			pendingChange = false;
			scheduleRefresh(changed);
		});
		$(document.body).on(
			'change',
			'input[name="billing_phone"], select[name="billing_country"]',
			() => scheduleRefresh(true)
		);
		$(document).ready(() => refresh(true));
	}
})(typeof jQuery === 'undefined' ? null : jQuery);
