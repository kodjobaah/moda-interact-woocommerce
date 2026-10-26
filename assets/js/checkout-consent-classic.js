/* global jQuery */
// Classic WooCommerce owns the checkout form and its authenticated update
// lifecycle. Moda observes customer actions; it never initializes the cart.
(function ($) {
	'use strict';
	let debugEnabled = false;
	try {
		debugEnabled =
			window.sessionStorage?.getItem('modaWooConsentDebug') === '1';
	} catch {
		// Disabled in browsers with restricted session storage.
	}
	function debug(event, details = {}) {
		if (!debugEnabled || typeof window.console?.info !== 'function') {
			return;
		}
		try {
			window.console.info('[Moda Woo Consent]', event, details);
		} catch {
			// Diagnostics must never affect checkout.
		}
	}
	debug('classic_script_loaded', { jqueryPresent: !!$ });
	if (!$) {
		return;
	}
	const choice = 'input[name="moda_interact_whatsapp_recovery_opt_in"]';
	const uncheckAction = 'moda_interact_whatsapp_recovery_unchecked_action';
	const checkAction = 'moda_interact_whatsapp_recovery_checked_action';
	const config = window.modaWooCheckoutConsentConfig;
	debug('classic_config', { configPresent: !!config });
	const notVerified = new Set([
		'consent_proof_missing',
		'consent_proof_phone_mismatch',
		'consent_status_remote_unverified',
	]);
	let serial = 0;
	let timer;
	let lastContact = null;
	let pendingChange = false;

	function form() {
		return $('form.checkout').first();
	}

	function setCheckbox(state) {
		const field = $(choice);
		debug('classic_view', { state });
		field.prop('disabled', state === 'checking' || state === 'unavailable');
		if (state === 'checked' || state === 'unchecked') {
			field.prop('checked', state === 'checked');
		}
		// Hide the optional Moda field while verification is unavailable;
		// the buyer must not see service errors or retry controls at checkout.
		field.closest('p.form-row').toggle(
			state !== 'checking' && state !== 'unavailable'
		);
	}

	async function request(body) {
		debug('classic_http_started', { action: 'status' });
		const response = await fetch(config.endpoint + 'status', {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': config.nonce,
			},
			body: JSON.stringify(body),
			cache: 'no-store',
		});
		debug('classic_http_response', {
			action: 'status',
			ok: response.ok === true,
			httpStatus: Number.isInteger(response.status)
				? response.status
				: null,
		});
		if (!response.ok) {
			let errorCode = 'non_json_response';
			try {
				const error = await response.json();
				if (
					typeof error?.code === 'string' &&
					/^[a-z0-9_-]{1,64}$/i.test(error.code)
				) {
					errorCode = error.code;
				}
			} catch {
				// Never use arbitrary HTML or response content as a diagnostic.
			}
			debug('classic_http_rejected', { action: 'status', errorCode });
			throw new Error('consent_status_unavailable');
		}
		return response.json();
	}

	async function refresh(force = false) {
		if (!config || !form().length || !$(choice).length) {
			return;
		}
		const checkout = form();
		const phone = checkout.find('input[name="billing_phone"]').val() || '';
		const country = checkout.find('[name="billing_country"]').val() || '';
		const contact = `${country}|${phone}`;
		if (!force && contact === lastContact) {
			return;
		}
		lastContact = contact;
		const id = ++serial;
		if (!phone) {
			setCheckbox('unchecked');
			return;
		}
		setCheckbox('checking');
		try {
			const result = await request({
				mode: 'CLASSIC',
				form: checkout.serialize(),
			});
			if (id !== serial) {
				return;
			}
			const reason = notVerified.has(result.reason)
				? result.reason
				: null;
			debug('classic_status_result', {
				confirmed: result.confirmed === true,
				reason,
			});
			if (result.confirmed === true) {
				checkout.find(`input[name="${checkAction}"]`).remove();
				setCheckbox('checked');
			} else if (
				notVerified.has(result.reason) ||
				result.reason === null ||
				result.reason === ''
			) {
				setCheckbox('unchecked');
			} else {
				setCheckbox('unavailable');
			}
		} catch {
			if (id === serial) {
				debug('classic_status_failed');
				setCheckbox('unavailable');
			}
		}
	}

	function scheduleRefresh(force = false) {
		serial++;
		clearTimeout(timer);
		timer = setTimeout(() => refresh(force), 400);
	}

	// An absent checkbox in a normal Woo refresh means nothing. Only this
	// explicit user event adds the hidden uncheck marker for Classic capture.
	$(document.body).on('change', choice, function () {
		if (this.disabled) {
			return;
		}
		debug('classic_checkbox_changed', { checked: this.checked === true });
		const checkout = $(this).closest('form.checkout');
		if (checkout.length) {
			checkout.find(`input[name="${uncheckAction}"]`).remove();
			checkout.find(`input[name="${checkAction}"]`).remove();
			$('<input>', {
				type: 'hidden',
				name: this.checked ? checkAction : uncheckAction,
				value: '1',
			}).appendTo(checkout);
		}
		pendingChange = true;
		$(document.body).trigger('update_checkout');
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
