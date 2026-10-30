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

	function form() {
		return $('form.checkout').first();
	}
	function contactKey(checkout) {
		const phone = checkout.find('input[name="billing_phone"]').val() || '';
		const country = checkout.find('[name="billing_country"]').val() || '';
		return `${country}|${phone}`;
	}
	function setActionError(visible) {
		const error = $('#moda-woo-consent-action-error');
		error.text(config?.changeFailed || '');
		error.prop('hidden', !visible);
	}
	function setView(state) {
		const field = $(choice);
		const granted = state === 'granted';
		debug('classic_view', { state });
		// A verified grant is a distinct status/button, never a checked checkbox.
		// On read failure the optional checkbox remains visible and neutral.
		field.prop('checked', false);
		field.prop('disabled', state === 'checking');
		field.closest('p.form-row').toggle(!granted);
		$('#moda-woo-consent-granted-label').text(config?.granted || '');
		$('#moda-woo-consent-withdraw').text(config?.withdraw || '');
		$('#moda-woo-consent-current-status').prop('hidden', !granted);
		if (!granted) {
			setActionError(false);
		}
	}

	async function request(path, body) {
		debug('classic_http_started', { action: path });
		const endpoint =
			path === 'status' ? config.statusEndpoint : config.withdrawEndpoint;
		if (!endpoint || !config.nonce) {
			throw new Error('consent_endpoint_unavailable');
		}
		const response = await fetch(endpoint, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				security: config.nonce,
				mode: body.mode,
				form: body.form,
				...(path === 'withdraw'
					? { confirmed: body.confirmed === true ? '1' : '0' }
					: {}),
			}).toString(),
			cache: 'no-store',
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
		return response.json();
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

	// Only a checked user action creates a grant marker. Unchecking merely
	// clears that pending choice; it NEVER publishes a REVOKE event.
	$(document.body).on('change', choice, function () {
		if (this.disabled) {
			return;
		}
		debug('classic_checkbox_changed', { checked: this.checked === true });
		const checkout = $(this).closest('form.checkout');
		if (checkout.length) {
			checkout.find(`input[name="${checkAction}"]`).remove();
			checkout
				.find(
					'input[name="moda_interact_whatsapp_recovery_unchecked_action"]'
				)
				.remove();
			if (this.checked) {
				$('<input>', {
					type: 'hidden',
					name: checkAction,
					value: '1',
				}).appendTo(checkout);
			}
		}
		pendingChange = true;
		$(document.body).trigger('update_checkout');
	});

	$(document.body).on(
		'click',
		'#moda-woo-consent-withdraw',
		async function (event) {
			event.preventDefault();
			if (
				!config ||
				withdrawalPending ||
				typeof window.confirm !== 'function'
			) {
				return;
			}
			// The browser confirmation is intentional: consent withdrawal is explicit.
			// eslint-disable-next-line no-alert
			if (!window.confirm(config.confirm)) {
				return;
			}
			const checkout = form();
			const contact = contactKey(checkout);
			withdrawalPending = true;
			$(this).prop('disabled', true);
			setActionError(false);
			try {
				const result = await request('withdraw', {
					mode: 'CLASSIC',
					confirmed: true,
					form: checkout.serialize(),
				});
				if (result.status !== 'withdrawn') {
					throw new Error('consent_ack_unavailable');
				}
				// The server has ACKed REVOKE. Ignore a racing status read.
				serial++;
				if (contact === contactKey(form())) {
					lastContact = contact;
					form().find(`input[name="${checkAction}"]`).remove();
					setView('neutral');
				} else {
					scheduleRefresh(true);
				}
				debug('classic_withdraw_ack');
			} catch {
				debug('classic_withdraw_failed');
				setActionError(true);
			} finally {
				withdrawalPending = false;
				$(this).prop('disabled', false);
			}
		}
	);

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
