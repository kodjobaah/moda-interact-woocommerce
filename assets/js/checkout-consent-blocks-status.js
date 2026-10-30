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
	const config = window.modaWooCheckoutConsentConfig;
	const wp = window.wp;
	const blocks = window.wc && window.wc.blocksCheckout;
	debug('blocks_script_loaded', {
		configPresent: !!config,
		wpElementPresent: !!wp?.element,
		wpDataPresent: !!wp?.data?.useSelect,
		wooRegistryPresent: !!blocks?.registerCheckoutBlock,
	});
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

	// API-006's UNVERIFIED includes unknown, revoked and STOP. Only an
	// affirmative server-side proof-backed CONFIRMED_GRANTED may display the
	// existing-permission action; read failures remain neutral and unchecked.
	function ConsentControl() {
		if (!renderSeen) {
			debug('blocks_component_rendered');
			renderSeen = true;
		}
		const contact = wp.data.useSelect((select) => {
			const store = select('wc/store/cart');
			const cart = store?.getCartData?.();
			const billing = cart?.billingAddress || {};
			return `${billing.country || ''}|${billing.phone || ''}`;
		}, []);
		const separator = contact.indexOf('|');
		const phone = contact.slice(separator + 1);
		const [status, setStatus] = useState('checking');
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

		async function change(action, payload, decision) {
			const id = generation.current;
			const previous = pendingAction.current;
			const stableId =
				previous?.contact === contact && previous?.decision === decision
					? previous.requestId
					: `moda-${Date.now().toString(36)}-${++requestCounter}`;
			pendingAction.current = { contact, decision, requestId: stableId };
			busyRef.current = true;
			setBusy(true);
			setActionError(false);
			try {
				const result = await request(action, payload, stableId);
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
				// The hosted ACK is required before changing the visible state.
				setStatus(decision === 'GRANT' ? 'granted' : 'ready');
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

		async function grant(fromStagedPhone = false) {
			if (
				busyRef.current ||
				(!fromStagedPhone &&
					(status === 'checking' || status === 'granted'))
			) {
				return;
			}
			debug('blocks_grant_requested', { hasPhone: !!phone });
			if (!phone) {
				setWaitingPhone(true);
				return;
			}
			await change('choice', { mode: 'BLOCKS', checked: true }, 'GRANT');
		}

		async function withdraw() {
			if (busyRef.current || status !== 'granted') {
				return;
			}
			// A separate, conscious confirmation; unchecking is never REVOKE.
			if (typeof window.confirm !== 'function') {
				return;
			}
			// The browser confirmation is intentional: consent withdrawal is explicit.
			// eslint-disable-next-line no-alert
			if (!window.confirm(config.confirm)) {
				return;
			}
			await change(
				'withdraw',
				{ mode: 'BLOCKS', confirmed: true },
				'REVOKE'
			);
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
				return;
			}
			if (waitingPhone) {
				// This is continuation of an actual click, not a draft-change grant.
				setWaitingPhone(false);
				setStatus('ready');
				const retry = window.setTimeout?.(() => grant(true), 300);
				if (retry !== undefined) {
					return () => window.clearTimeout?.(retry);
				}
				void grant(true);
				return;
			}
			setStatus('checking');
			const verify = () => {
				request('status', { mode: 'BLOCKS' })
					.then((result) => {
						if (id !== generation.current) {
							return;
						}
						debug('blocks_status_result', {
							confirmed: result.confirmed === true,
							reason: diagnosticReason(result.reason),
						});
						setStatus(
							result.confirmed === true ? 'granted' : 'ready'
						);
					})
					.catch(() => {
						if (id === generation.current) {
							setStatus('ready');
							debug('blocks_status_failed');
						}
					});
			};
			// Debounce billing edits; Woo's server also avoids remote reads
			// without a server-held shopper/session/phone grant proof.
			const timer = window.setTimeout?.(verify, 450);
			if (timer === undefined) {
				verify();
			}
			return () => {
				if (timer !== undefined) {
					window.clearTimeout?.(timer);
				}
				generation.current = id + 1;
			};
			// A stable Woo billing contact is the only refresh trigger.
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [contact]);

		const error = actionError
			? h('p', { role: 'alert' }, config.changeFailed)
			: null;
		if (status === 'granted') {
			return h(
				'div',
				{ className: 'moda-woo-checkout-consent', 'aria-busy': busy },
				h(
					'p',
					{ role: 'status', 'aria-live': 'polite' },
					config.granted
				),
				h(
					'button',
					{
						type: 'button',
						disabled: busy,
						onClick: withdraw,
					},
					config.withdraw
				),
				error
			);
		}
		return h(
			'div',
			{ className: 'moda-woo-checkout-consent', 'aria-busy': busy },
			h(
				'label',
				null,
				h('input', {
					type: 'checkbox',
					checked: waitingPhone,
					disabled: busy || status === 'checking',
					onChange: (event) => {
						if (event.target.checked) {
							void grant();
						} else if (waitingPhone) {
							setWaitingPhone(false);
						}
					},
				}),
				config.optIn
			),
			waitingPhone ? h('p', null, config.waitForPhone) : null,
			error
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
})();
