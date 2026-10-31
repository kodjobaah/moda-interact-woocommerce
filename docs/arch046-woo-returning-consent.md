# ARCH-046-WOOCOMMERCE-003 — Returning customer status, consent and withdrawal

## WOO-003 implementation (incremental Attempt 9)

- The WooCommerce producer continues to publish only the six-field `woo.whatsapp-consent.v2` consent event. GRANT uses the store's Site Language and original displayed text; REVOKE carries `disclosure: null`. API-007 records each acknowledged action atomically.
- Only after a successful hosted GRANT acknowledgement does Woo store the original unpredictable event ID as a private proof pointer. It is bound to merchant installation/credential version, an HMAC of the canonical phone and a guest Woo session/checkout key or authenticated WordPress user metadata. A phone match alone, account login or the local proof alone **does not establish current consent**.
- `CheckoutConsentStatusReader` now calls the API-006 proof-backed `POST /v1/woocommerce/whatsapp-consent/status` **server-to-server** with `{schemaVersion, canonicalPhone, grantEventId}` and installation authentication. It accepts only the documented `CONFIRMED_GRANTED`/`UNVERIFIED` contract; errors, revoked installation, no proof, stale revision or current STOP fail closed to unverified. WordPress visitors never receive the proof, bearer credential, customer ID, phone status, consent history or STOP reason.
- A local nonce/session-protected WordPress `POST /checkout-consent/status` responds only `{confirmed: boolean}`. Classic checkout checks on load and on relevant phone/checkout changes and displays either the unchecked opt-in or a confirmed-permission notice and distinct confirmable withdrawal button. It never automatically checks a new opt-in box on a returning visit.
- Checkout Blocks uses a WooCommerce checkout SlotFill instead of a native Additional Checkout Field. The component renders **either** its unchecked opt-in or confirmed-permission/withdrawal action, never both. Billing-contact changes trigger a fresh status check; out-of-order client responses are ignored. An explicit opt-in selected before a valid phone is pending, not permission, and is retried only when Woo has accepted the server-side billing contact.
- Blocks explicit choices require the current WordPress REST nonce, a `wc_store_api` nonce and an active Woo cart/session. The PHP server always normalizes its current Woo billing contact itself; the browser cannot choose a phone or send the Moda proof. Classic consent continues through Woo's authenticated `update_checkout` lifecycle.
- Returning-customer withdrawal no longer requires a prior checkbox observation in the current checkout. It requires a currently verified proof and deliberate confirmation and uses a **new decision timestamp**. A lost ACK retains the identical event ID/body for retry. A successful REVOKE ACK removes only local grant proof and changes consent through API-007; it does not clear any authoritative WhatsApp STOP.
- Existing consent remains valid when the status reader is unavailable. An unverified checkout shows an optional unchecked opt-in and never silently revokes previous permission. A fresh checkout or phone/account transition cannot borrow another user's proof.

## Integration and certification boundary

The API-006 request and response used here are from the ARCH-046 task contract. The **deployed API-006 implementation source was not included in this snapshot**, so the production endpoint and its STOP/revision logic must be checked against the actual deployed API and disposable PostgreSQL in LocalWP. The previous isolated PHP harness, JavaScript/i18n tests and syntax checks do not establish full PHPunit, webpack lint, browser/Blocks lifecycle or end-to-end certification. Keep WOO-003 in progress until those checks pass.

Woo checkout must remain usable when API-006 is down; no consent-status read creates a recovery, sends a message, starts billing or mutates durable consent evidence. No new database, Shared contract or WOO-008 task is required.

## Attempt 22 — distinguish v2 write acknowledgement from API-006 confirmation

A successful Store API checkbox choice followed by a hosted v2 GRANT ACK must
not be silently rendered as a fresh unchecked opt-in simply because API-006
subsequently returns `UNVERIFIED`. Checkout Blocks now separates **current
permission confirmed by API-006** from **an opt-in acknowledged locally in the
same checkout but current permission not confirmed**. The latter view offers
an explicit same-checkout reversal and a bounded status recheck, not an
unverified claim that WhatsApp messages may be sent. A failed status lookup
after the GRANT ACK does not reclassify that ACK as a failed write.

`CheckoutConsentProof::inspectForCurrentShopper`,
`CheckoutConsentStatusReader::inspect` and
`CheckoutConsentCapture::permissionStatus` return fixed non-sensitive failure
reasons without changing the underlying proof or grant/withdraw authority.
The Store API status response propagates only these fixed codes. Provider
revocation/STOP and other API-006 `UNVERIFIED` causes remain deliberately
indistinguishable to browsers. Browser-visible responses never contain the
original proof, customer ID, canonical recipient or installation credentials.

## Attempt 23 — One checkbox, one deliberate consent action

API-006 remains the only authority for deciding whether an existing grant
can be shown as current. Blocks and Classic now render **one checkbox**: checked
when a shopper-bound proof is confirmed as `GRANTED`, otherwise unchecked when
no permission is confirmed. A lack of proof must never be substituted by a
phone-only lookup. If the status API or identity boundary is unavailable, the
checkbox is disabled with an operational retry rather than presenting an
unchecked field as evidence of a revoked permission. The checkout itself remains
usable.

Changing that checkbox is the only consent action: an explicit check sends
`GRANT`; an explicit uncheck sends `REVOKE`. The server distinguishes an
acknowledged same-checkout grant from a returning shopper's proof-backed grant,
so revocation never relies on an unchecked default or an unverified caller
assertion. No initial render, checkout refresh, status read or autofill emits a
consent-write event. Store API request IDs remain stable on an uncertain retry,
and identical or stale replays are idempotent or rejected. Browser responses
carry only bounded statuses and diagnostics, never proof data, phone numbers or
installation credentials. All Woo cart/customer objects remain Woo-owned.

After a synchronous GRANT ACK, the single checkbox remains checked. If the
separate API-006 read is temporarily unavailable, the UI labels current status
as unverified and permits a same-checkout reversal; it never claims verified
permission or clears an authoritative WhatsApp STOP. The remote consent status
endpoint retains its bounded timeout to avoid introducing a checkout dependency
on a slow Moda API.

This supersedes the multi-panel presentation and separate withdrawal button
explained in the historical Attempt 9/22 notes above; it does not change the
published v2 write contract or API-006 proof contract.

## Attempt 26 — unobtrusive checkout and bounded diagnostics

The customer-facing checkout renders only Moda's single optional checkbox.
When the authoritative status read is checking or unavailable, the Blocks
component renders nothing; Classic hides only its native Moda checkbox row.
Neither variant displays a service-error paragraph or "Check status" button.
The merchant checkout must remain usable without Moda, and no status failure
changes `CustomerPhone` or creates a `REVOKE` event.

A successful v2 GRANT acknowledgement is sufficient to retain the shopper's
newly recorded checkbox choice for the **current checkout**. There is no
immediate redundant API-006 read after that write. A returning shopper still
requires the original proof-backed API-006 check before the checkbox may be
initialised as checked. Guest proof scope, STOP and current-consent enforcement
are unchanged. An explicit failed choice leaves the last acknowledged checkbox
state unchanged and records diagnostics without adding checkout UI.

For local diagnosis only, with `WP_DEBUG` enabled and WooCommerce logging
available, a failed hosted status read emits a bounded warning under source
`moda-interact-consent`, containing only a fixed failure category and numeric
HTTP status (`0` when unknown). No browser response or diagnostic includes
phone numbers, proof identifiers, request payload, credentials or exception
messages. A `remote_rejected` result with HTTP `404` indicates that the
configured hosted API does not expose the status route; `401/403` indicates an
authorisation problem; status `0` requires inspecting the server's transport
configuration/timeouts. This diagnostic must not be used as permission to
bypass shopper identity proof or the hosted status check.
