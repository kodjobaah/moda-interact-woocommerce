// Woo Blocks forced inner block in Checkout Fields, never Order Summary.
(function () {
	'use strict';
	// Browser-only, opt-in diagnostics: never emit checkout fields, numbers,
	// nonces, customer identifiers, consent proof or request/response bodies.
	let debugEnabled = false;
	try {
		debugEnabled =
			window.sessionStorage?.getItem('modaWooConsentDebug') === '1';
	} catch {
		// Privacy/storage restrictions disable diagnostics, never checkout.
	}
	function debug(event, details = {}) {
		if (!debugEnabled || typeof window.console?.info !== 'function') {
			return;
		}
		try {
			window.console.info('[Moda Woo Consent]', event, details);
		} catch {
			// Console failures must not alter consent behaviour.
		}
	}
	function probeMount(phase) {
		const doc = window.document;
		if (
			!debugEnabled ||
			typeof doc?.getElementsByClassName !== 'function'
		) {
			return;
		}
		debug('blocks_mount_probe', {
			phase,
			mountCount: doc.getElementsByClassName(
				'wp-block-moda-interact-checkout-consent'
			).length,
		});
	}
	const config = window.modaWooCheckoutConsentConfig;
	const wp = window.wp;
	const blocks = window.wc && window.wc.blocksCheckout;
	debug('blocks_script_loaded', {
		configPresent: !!config,
		wpElementPresent: !!wp?.element,
		wpDataPresent: !!wp?.data?.useSelect,
		wooRegistryPresent: !!blocks?.registerCheckoutBlock,
	});
	if (debugEnabled && typeof window.setTimeout === 'function') {
		window.setTimeout(() => probeMount('script'), 0);
		window.setTimeout(() => probeMount('hydration'), 1500);
	}
	if (
		!config ||
		!wp ||
		!wp.data ||
		!wp.data.useSelect ||
		!wp.element ||
		!blocks ||
		!blocks.registerCheckoutBlock
	) {
		debug('blocks_registration_blocked');
		return;
	}
	const { createElement: h, useState, useEffect, useRef } = wp.element;
	let renderSeen = false;
	let requestCounter = 0;

	// Only fixed server-owned diagnostic codes may reach DevTools. Never log
	// arbitrary response text, customer details, or request bodies.
	const safeReasons = new Set([
		'consent_proof_scope_unavailable',
		'consent_proof_phone_invalid',
		'consent_proof_missing',
		'consent_proof_digest_unavailable',
		'consent_proof_phone_mismatch',
		'consent_proof_installation_mismatch',
		'consent_proof_shopper_mismatch',
		'consent_proof_event_invalid',
		'consent_proof_checkout_mismatch',
		'consent_status_proof_unavailable',
		'consent_status_remote_unverified',
		'consent_status_installation_unavailable',
		'consent_status_site_mismatch',
		'consent_status_installation_changed',
		'consent_status_response_unrecognised',
		'consent_status_remote_unavailable',
		'consent_status_phone_missing',
		'consent_status_phone_invalid',
		'consent_status_context_unavailable',
		'consent_status_contact_unavailable',
		'billing_contact_unavailable',
		'capture_observe_cart_empty',
		'capture_observe_cart_invalid',
		'capture_observe_cart_unavailable',
		'capture_observe_checkout_key_unavailable',
		'capture_observe_context_change_requires_neutral',
		'capture_observe_feature_ineligible',
		'capture_observe_grant_already_checked',
		'capture_observe_store_choice_id_conflict',
		'capture_observe_store_choice_stale_replay',
		'capture_observe_store_choice_history_full',
		'capture_observe_grant_publish_unacknowledged',
		'capture_observe_grant_retry_unacknowledged',
		'capture_observe_grant_timestamp_unavailable',
		'capture_observe_invalid_mode',
		'capture_observe_neutral_selection_observed',
		'capture_observe_neutral_selection_required',
		'capture_observe_phone_change_requires_neutral',
		'capture_observe_phone_invalid',
		'capture_observe_phone_missing',
		'capture_observe_revoke_publish_unacknowledged',
		'capture_observe_revoke_retry_unacknowledged',
		'capture_observe_revoke_timestamp_unavailable',
		'capture_observe_session_identity_unavailable',
		'capture_observe_session_unavailable',
		'capture_observe_uncheck_without_prior_grant',
		'capture_observe_unchecked_without_action',
		'capture_observe_unclassified',
		'capture_observe_unverified_context',
		'capture_withdraw_checkout_key_unavailable',
		'capture_withdraw_context_mismatch',
		'capture_withdraw_invalid_mode',
		'capture_withdraw_phone_invalid',
		'capture_withdraw_phone_missing',
		'capture_withdraw_principal_unavailable',
		'capture_withdraw_proof_unavailable',
		'capture_withdraw_publish_unacknowledged',
		'capture_withdraw_session_unavailable',
		'capture_withdraw_status_unconfirmed',
		'capture_withdraw_timestamp_unavailable',
		'capture_withdraw_unclassified',
		'capture_withdraw_unverified_context',
		'checkout_cart_unavailable',
		'rest_context_unavailable',
		'store_api_action_invalid',
		'store_api_billing_phone_mismatch',
		'store_api_choice_value_invalid',
		'store_api_customer_unavailable',
		'store_api_expected_country_invalid',
		'store_api_expected_phone_invalid',
		'store_api_expected_phone_unparseable',
		'store_api_request_id_invalid',
		'store_api_server_phone_invalid',
		'store_api_session_unavailable',
		'store_api_withdraw_confirmation_missing',
		'store_nonce_invalid',
	]);
	function diagnosticReason(reason) {
		return safeReasons.has(reason) ? reason : null;
	}

	// API-006's UNVERIFIED includes revoked, unknown and STOP. A lack of a
	// shopper-bound grant proof is not a confirmed GRANT either. Distinguish
	// ordinary unverified results from a failed/unsafe status read.
	const unavailableReasons = new Set([
		'consent_proof_scope_unavailable',
		'consent_proof_digest_unavailable',
		'consent_proof_installation_mismatch',
		'consent_proof_shopper_mismatch',
		'consent_proof_checkout_mismatch',
		'consent_status_installation_unavailable',
		'consent_status_site_mismatch',
		'consent_status_installation_changed',
		'consent_status_response_unrecognised',
		'consent_status_remote_unavailable',
		'consent_status_context_unavailable',
		'consent_status_contact_unavailable',
		'store_api_session_unavailable',
		'store_api_customer_unavailable',
	]);

	function ConsentControl() {
		if (!renderSeen) {
			debug('blocks_component_rendered');
			renderSeen = true;
		}
		// Subscribe only to current Woo contact data. This component never sets
		// Woo cart/customer properties to force a permission check to work.
		const contact = wp.data.useSelect((select) => {
			const store = select('wc/store/cart');
			const cart =
				store && store.getCartData ? store.getCartData() : null;
			const billing = (cart && cart.billingAddress) || {};
			return `${billing.country || ''}|${billing.phone || ''}`;
		}, []);
		const separator = contact.indexOf('|');
		const phone = contact.slice(separator + 1);
		// A verified status controls returning-customer presentation; the
		// current checkout's committed GRANT acknowledgement is also reliable.
		// A failed remote status read must never become a merchant checkout task.
		const [status, setStatus] = useState('checking');
		const [selected, setSelected] = useState(false);
		const [waitingPhone, setWaitingPhone] = useState(false);
		const [busy, setBusy] = useState(false);
		const [actionError, setActionError] = useState(false);
		const generation = useRef(0);
		const busyRef = useRef(false);
		const pendingAction = useRef(null);

		async function request(action, payload, stableId = null) {
			debug('blocks_http_started', { action, transport: 'store_api' });
			if (typeof blocks.extensionCartUpdate !== 'function') {
				debug('blocks_http_rejected', {
					action,
					errorCode: 'store_api_unavailable',
				});
				throw new Error('consent_request_unavailable');
			}
			const requestId =
				stableId ||
				`moda-${Date.now().toString(36)}-${++requestCounter}`;
			try {
				await blocks.extensionCartUpdate({
					namespace: 'moda-interact-consent',
					overwriteDirtyCustomerData: false,
					data: {
						...payload,
						action,
						requestId,
						expectedPhone: phone,
						expectedCountry: contact.slice(0, separator),
					},
				});
			} catch {
				debug('blocks_http_rejected', {
					action,
					errorCode: 'store_api_request_failed',
				});
				throw new Error('consent_request_unavailable');
			}
			const cart = wp.data.select?.('wc/store/cart')?.getCartData?.();
			const result = cart?.extensions?.['moda-interact-consent'];
			const matched = result?.requestId === requestId;
			debug('blocks_http_response', { action, ok: matched });
			if (!matched) {
				debug('blocks_http_rejected', {
					action,
					errorCode: 'store_api_result_unavailable',
				});
				throw new Error('consent_ack_unavailable');
			}
			return result;
		}

		function setCurrent(result, id) {
			if (id !== generation.current) {
				return;
			}
			debug('blocks_status_result', {
				confirmed: result.confirmed === true,
				reason: diagnosticReason(result.reason),
			});
			if (result.confirmed === true) {
				setSelected(true);
				setStatus('ready');
			} else if (unavailableReasons.has(result.reason)) {
				setSelected(false);
				setStatus('unavailable');
			} else {
				// This is not an assertion that a matching phone has never granted.
				// It means no current GRANT has been verified for this shopper.
				setSelected(false);
				setStatus('ready');
			}
		}

		async function choose(checked, fromStagedPhone = false) {
			debug('blocks_checkbox_choice', { checked, hasPhone: !!phone });
			if (
				busyRef.current ||
				(!fromStagedPhone &&
					(status === 'checking' || status === 'unavailable'))
			) {
				return;
			}
			if (!checked && waitingPhone) {
				debug('blocks_pending_grant_cancelled');
				setWaitingPhone(false);
				setSelected(false);
				return;
			}
			if (checked && !phone) {
				debug('blocks_grant_waiting_for_phone');
				setWaitingPhone(true);
				setSelected(true);
				return;
			}
			const id = generation.current;
			// The server chooses same-checkout reversal versus proof-backed
			// returning-shopper withdrawal. This remains ONE checkbox action.
			const action = 'choice';
			const previous = pendingAction.current;
			const stableId =
				previous?.contact === contact && previous?.checked === checked
					? previous.requestId
					: `moda-${Date.now().toString(36)}-${++requestCounter}`;
			pendingAction.current = { contact, checked, requestId: stableId };
			busyRef.current = true;
			setBusy(true);
			setActionError(false);
			try {
				const result = await request(
					action,
					{ mode: 'BLOCKS', checked },
					stableId
				);
				if (id !== generation.current) {
					return;
				}
				const recorded = result.status === 'recorded';
				debug('blocks_choice_ack', {
					recorded,
					reason: diagnosticReason(result.reason),
				});
				if (!recorded) {
					setActionError(true);
					return;
				}
				pendingAction.current = null;
				setWaitingPhone(false);
				setSelected(checked);
				if (!checked) {
					setStatus('ready');
					return;
				}
				// The hosted write already acknowledged this explicit GRANT.
				// Avoid a redundant status request and never convert its failure
				// into checkout-facing instructions or extra UI.
				setStatus('ready');
			} catch {
				if (id === generation.current) {
					setActionError(true);
					debug('blocks_choice_failed');
				}
			} finally {
				if (id === generation.current) {
					busyRef.current = false;
					setBusy(false);
				}
			}
		}

		useEffect(() => {
			debug('blocks_contact_changed', { hasPhone: !!phone });
			const id = ++generation.current;
			busyRef.current = false;
			pendingAction.current = null;
			setBusy(false);
			setActionError(false);
			if (!phone) {
				setStatus('ready');
				if (!waitingPhone) {
					setSelected(false);
				}
				return;
			}
			if (waitingPhone) {
				// The customer explicitly selected opt-in before adding a phone.
				// Continue once the Woo Store API has observed that contact.
				setWaitingPhone(false);
				setStatus('ready');
				const retry = setTimeout(() => choose(true, true), 250);
				return () => {
					clearTimeout(retry);
					generation.current = id + 1;
				};
			}
			setSelected(false);
			setStatus('checking');
			request('status', { mode: 'BLOCKS' })
				.then((result) => setCurrent(result, id))
				.catch(() => {
					if (id === generation.current) {
						setStatus('unavailable');
						debug('blocks_status_failed');
					}
				});
			return () => {
				generation.current = id + 1;
			};
			// Only a billing-contact change starts another status read.
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [contact]);

		// Operational failures must never interrupt a merchant checkout.
		// Hide only Moda's optional field until a safe status is available.
		if (status === 'checking' || status === 'unavailable') {
			return null;
		}
		return h(
			'div',
			{ className: 'moda-woo-checkout-consent' },
			h(
				'label',
				null,
				h('input', {
					type: 'checkbox',
					checked: selected,
					disabled: busy,
					onChange: (event) => choose(event.target.checked),
				}),
				config.optIn
			)
		);
	}

	// A forced Checkout Fields inner block renders in the LEFT form column.
	// ExperimentalOrderMeta is explicitly an Order Summary slot and caused the
	// opt-in to be clipped inside the right-hand order totals in Attempt 9.
	debug('blocks_registration_started');
	blocks.registerCheckoutBlock({
		metadata: {
			name: 'moda-interact/checkout-consent',
			parent: ['woocommerce/checkout-fields-block'],
			attributes: {
				lock: {
					type: 'object',
					default: { remove: true, move: true },
				},
			},
		},
		component: ConsentControl,
	});
	debug('blocks_registered');

	// Woo's registry renders real checkout inner blocks, but existing saved
	// checkout pages do not contain the synthetic block inserted by the PHP
	// render filter in Woo's *parsed* inner-block tree. The diagnostic probe
	// confirms that this element survives hydration yet is never rendered by
	// registerCheckoutBlock. Mount only that server-owned, explicit placeholder.
	// Saved merchant blocks remain entirely owned by the Woo registry.
	let runtimeNode = null;
	let runtimeRoot = null;
	function mountRuntimePlaceholder() {
		const nodes = window.document?.getElementsByClassName?.(
			'wp-block-moda-interact-checkout-consent'
		);
		if (!nodes) {
			debug('blocks_runtime_mount_absent');
			return;
		}
		for (const node of nodes) {
			if (node.getAttribute?.('data-moda-woo-runtime-mount') !== '1') {
				continue;
			}
			if (
				node.closest &&
				!node.closest(
					'[data-block-name="woocommerce/checkout-fields-block"], .wp-block-woocommerce-checkout-fields-block'
				)
			) {
				debug('blocks_runtime_mount_wrong_location');
				return;
			}
			if (runtimeNode === node) {
				return;
			}
			if (typeof wp.element.createRoot !== 'function') {
				debug('blocks_runtime_mount_unavailable');
				return;
			}
			try {
				if (runtimeRoot) {
					runtimeRoot.unmount();
				}
				const root = wp.element.createRoot(node);
				root.render(h(ConsentControl));
				runtimeNode = node;
				runtimeRoot = root;
				debug('blocks_runtime_mount_requested');
			} catch {
				runtimeNode = null;
				runtimeRoot = null;
				debug('blocks_runtime_mount_failed');
			}
			return;
		}
		debug('blocks_runtime_mount_absent');
	}
	if (window.document?.readyState === 'loading') {
		window.document.addEventListener?.(
			'DOMContentLoaded',
			mountRuntimePlaceholder,
			{ once: true }
		);
	} else {
		mountRuntimePlaceholder();
	}
	// Re-check once after Woo's checkout hydration. Remount only if the
	// placeholder was replaced; never create multiple roots on the same node.
	if (typeof window.setTimeout === 'function') {
		window.setTimeout(mountRuntimePlaceholder, 1500);
	}
})();
