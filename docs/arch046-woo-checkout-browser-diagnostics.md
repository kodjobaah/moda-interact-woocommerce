# ARCH-046-WOOCOMMERCE-003: opt-in checkout browser diagnostics

Use browser diagnostics to troubleshoot a missing Checkout Blocks consent control or a returning customer's unverified consent. Diagnostics are disabled by default; they do not contact another service or change consent state.

On the checkout page, open DevTools **Console**, then enable for the current browser tab and reload:

```js
sessionStorage.setItem('modaWooConsentDebug', '1');
location.reload();
```

Filter Console for `[Moda Woo Consent]` (Info level). Interpret the events in order:

- `blocks_script_loaded` means the frontend file executed; its booleans indicate whether WooCommerce/WordPress APIs and the consent configuration were available.
- `blocks_registration_blocked` means the file loaded but a required dependency was missing. Otherwise `blocks_registration_started` and `blocks_registered` show registration succeeded.
- The server inserts a **parsed** `moda-interact/checkout-consent` child of `woocommerce/checkout-fields-block` during `render_block_data`. WooCommerce `registerCheckoutBlock()` is its only frontend mount. There are no direct `createRoot()` calls or PHP HTML placeholders. A missing child requires inspecting the checkout's saved parsed fields tree and the active Woo Blocks integration, not adding a second React mount.
- `blocks_component_rendered` means the component executed. `blocks_contact_changed` reports **only** whether the billing phone is present, never its value.
- `blocks_http_started`, `blocks_http_response`, `blocks_status_result`, `blocks_status_failed` show whether the authenticated Woo Store API cart/extensions operation ran and whether a proof-backed grant was confirmed. No result should ever be interpreted as proof of consent without API confirmation.
- `classic_*` events give the equivalent execution, status and withdrawal details for Classic checkout.

If **no** `[Moda Woo Consent]` messages appear, inspect script/mount presence manually (this prints only booleans):

```js
console.table({
  blocksScriptPresent: [...document.scripts].some((script) =>
    script.src.includes('checkout-consent-blocks-status.js')
  ),
  configPresent: Boolean(window.modaWooCheckoutConsentConfig),
  registryPresent: Boolean(window.wc?.blocksCheckout?.registerCheckoutBlock),
  innerBlockCount: document.querySelectorAll(
    '[data-block-name="moda-interact/checkout-consent"]'
  ).length,
});
```

## Consent rejection codes (Attempt 20)

A Store API call can complete successfully while the consent action is **not recorded**. This is reported as `status: unverified` with one fixed `reason` string, not the former shared `capture_not_recorded` catch-all. Enable the diagnostics above and inspect `blocks_choice_ack.reason` (or `blocks_withdraw_ack.reason`). A failed write displays the translated retry message: internal diagnostic codes must not become user-facing error copy.

| Reason | Exact branch | Interpretation |
| --- | --- | --- |
| `store_api_request_id_invalid` / `store_api_action_invalid` | Store API envelope | Invalid request correlation ID or action |
| `store_api_expected_phone_invalid` / `store_api_expected_country_invalid` / `store_api_expected_phone_unparseable` | Store API input guard | Expected contact failed local shape/format checks |
| `store_api_session_unavailable` / `store_api_customer_unavailable` | Store API Woo context | Woo has not supplied an authenticated existing session or contact object |
| `store_api_server_phone_invalid` / `store_api_billing_phone_mismatch` | Store API current contact | Woo-observed phone unavailable or different from the expected checkout phone |
| `store_api_choice_value_invalid` / `store_api_withdraw_confirmation_missing` | Store API action guard | Invalid checkbox action or missing explicit withdrawal confirmation |
| `capture_observe_cart_unavailable` / `capture_observe_cart_invalid` / `capture_observe_cart_empty` | Capture cart admission | Woo cart unavailable, unreadable or empty; Moda does **not** load/repair it |
| `capture_observe_checkout_key_unavailable` / `capture_observe_session_identity_unavailable` | Capture checkout identity | No valid checkout key or session identity |
| `capture_observe_context_change_requires_neutral` / `capture_observe_phone_change_requires_neutral` / `capture_observe_neutral_selection_required` | Capture identity/phone transition | Explicit neutral observation required after a customer/phone transition |
| `capture_observe_neutral_selection_observed` / `capture_observe_unchecked_without_action` | Capture neutral observation | No new consent decision is made |
| `capture_observe_grant_already_checked` | Capture deduplication | The same checked state was seen through a Classic/automatic checkout update, without a fresh Store API choice ID. No new GRANT. |
| `capture_observe_store_choice_id_conflict` | Store API action deduplication | A browser request ID was reused with a different GRANT/REVOKE decision; reject. |
| `capture_observe_store_choice_stale_replay` | Store API action deduplication | An older action ID was replayed after another decision or while a different action is pending; never restore old consent. |
| `capture_observe_store_choice_history_full` | Store API session safety limit | Too many distinct choices in one checkout. Reject further grants rather than evict older replay IDs; deliberate withdrawal remains available. |
| `capture_observe_grant_retry_unacknowledged` / `capture_observe_grant_publish_unacknowledged` | Grant delivery | No confirmed ACK for an original or retried grant |
| `capture_observe_grant_timestamp_unavailable` / `capture_observe_feature_ineligible` | Grant preconditions | Valid new event time unavailable or recovery feature disabled |
| `capture_observe_uncheck_without_prior_grant` | Withdrawal transition | No acknowledged checked state in this checkout |
| `capture_observe_revoke_retry_unacknowledged` / `capture_observe_revoke_publish_unacknowledged` | Revoke delivery | Withdrawal ACK not obtained; no successful revoke can be claimed |
| `capture_withdraw_proof_unavailable` / `capture_withdraw_status_unconfirmed` | Explicit withdrawal | Saved shopper proof missing or API-006 did not confirm the current grant |
| `capture_withdraw_context_mismatch` / `capture_withdraw_publish_unacknowledged` | Explicit withdrawal | Checkout identity does not match, or outbound REVOKE was not acknowledged |

A newly checked Blocks control may send a *new* Store API GRANT choice ID when current permission is not verified. This records fresh consent and a new shopper-bound proof without resetting session state during a status read. Exact request retries are idempotent within a bounded 32-receipt per-checkout history that never evicts during that checkout; no cart/customer objects are initialised or replaced. Classic checkout and automatic draft refreshes do not receive the explicit action ID and retain the existing duplicate suppression. A stale or conflicting request ID must never restore a withdrawn grant.

Additional uncommon `capture_observe_*`, `capture_withdraw_*` and `store_api_*` identifiers name their exact failed guard; all are **static strings only**. They never contain phone numbers, event IDs, proof IDs, credentials, cart contents or other checkout fields. Missing WooCommerce objects must fail closed: do not add `wc_load_cart()`, cart writes, session creation or repeated `get_cart()` probes for diagnostics. No logging is enabled by default, and diagnostic labels are not user-facing authorization or consent evidence.

After debugging, disable in this tab:

```js
sessionStorage.removeItem('modaWooConsentDebug');
location.reload();
```

Only fixed diagnostic event names, booleans, action labels and HTTP status codes are printed. Do not add phone numbers, form contents, access tokens, WordPress nonces, proof identifiers or server response bodies to browser logs. Share only these redacted event lines with the architect.

## Attempt 22 — proof/status stage diagnostics and an acknowledged GRANT

A successful v2 `GRANT` is durable after the hosted API acknowledges it. A
subsequent API-006 check is **separate**: it may return `UNVERIFIED` because the
current shopper has no retained proof, the proof is bound to a different
checkout/account/installation, or API-006 cannot confirm current consent and
STOP state. Never interpret an API-006 `UNVERIFIED` as a failure of the
acknowledged consent write.

`blocks_status_result.reason` now reports a fixed, bounded category, with no
phone number, grant-event ID, proof, bearer token or provider STOP detail:

| Code | Stage |
| --- | --- |
| `consent_proof_missing` | No acknowledged grant proof retained for this Woo shopper |
| `consent_proof_scope_unavailable` | Existing Woo shopper/install context unavailable; Moda does not initialize it |
| `consent_proof_phone_mismatch` | Saved proof is for another canonical phone |
| `consent_proof_checkout_mismatch` | Guest Woo session or checkout key changed |
| `consent_proof_shopper_mismatch` | Saved proof belongs to another authenticated WordPress identity |
| `consent_proof_installation_mismatch` | Saved proof was issued under another merchant installation/version |
| `consent_proof_digest_unavailable` / `consent_proof_event_invalid` | Local proof cannot be authenticated or is malformed |
| `consent_status_installation_unavailable` / `consent_status_site_mismatch` / `consent_status_installation_changed` | Local installation/site could not pass the API-006 call-site checks |
| `consent_status_remote_unavailable` / `consent_status_response_unrecognised` | No trustworthy API-006 response was obtained |
| `consent_status_remote_unverified` | API-006 responded `UNVERIFIED`, deliberately without disclosing why |
| `consent_status_phone_missing` / `consent_status_phone_invalid` | Checkout contact is missing or invalid |

A browser status response contains only `{ confirmed, reason }` (Classic) or
the equivalent bounded Store API `extensions` fields (Blocks). It contains
no proof capability, phone, customer identity, provider STOP reason or audit
history. These codes are **diagnostics**, never customer-facing consent claims.

After a hosted GRANT ACK:

- `CONFIRMED_GRANTED` (or an ACK of the customer's current explicit GRANT) displays the existing-permission view and a **separate** Withdraw button.
- A returning checkout without confirmed current GRANT displays a **neutral, unchecked** opt-in. An API-006 outage must not hide the control or imply an existing grant. It also must not trigger a consent decision.
- A withdrawal requires the button, browser confirmation and a fresh server-side proof check; only a hosted REVOKE ACK changes the UI. A lost ACK retries the identical request identity. Unchecking a checkbox or a Woo draft refresh never triggers REVOKE.
- Blocks uses `woocommerce/checkout-fields-block` parsed-child insertion and Woo's single registry; Classic uses native `woocommerce_checkout_fields` and `woocommerce_after_checkout_billing_form` with a separate authenticated WordPress REST withdraw route.
- A full LocalWP Blocks checkout smoke test is mandatory before treating the parsed child integration as verified; a JS/PHP mock cannot prove Woo's hydration/rendering against the installed runtime.

The consent-status and proof-inspection paths do not create WooCommerce carts,
customers or sessions, allocate checkout keys, write new consent evidence, or
call the grant endpoint. Debugging remains opt-in and prints fixed codes only.
