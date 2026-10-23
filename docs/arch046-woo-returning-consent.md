# ARCH-046-WOOCOMMERCE-003 — Later customer consent and withdrawal

This task extends the accepted **pre-submit** Woo consent producer (WOOCOMMERCE-002). No new current-consent table, Woo checkout/customer identity relation, hosted API endpoint, scheduled recovery work or Shopify integration is introduced. Actual Checkout Recovery remains a separate, future normal reconciliation decision.

## Deliberate later decision

The original opt-in checkbox remains **optional and initially unchecked on every checkout**. An unchecked checkbox on a new visit **does not revoke an earlier hosted consent decision**. Since the hosted API v1 has no customer-facing current-consent read endpoint, the checkout does **not** claim to display the current remote preference. Its additional *select* offers a distinct explicit action: **Withdraw earlier WhatsApp reminder permission**. The neutral default is **Keep earlier permission unchanged**. It is not a second marketing opt-in checkbox or a third-party provider selector.

- Classic checkout registers the select through Woo's standard checkout-fields filter. Changing it triggers Woo's existing order-review AJAX lifecycle; a server-verified current nonce and live checkout form provide phone and country.
- Blocks registers the select through Woo's official Additional Checkout Fields API at the `order` location. Only an authenticated draft `PUT`/`PATCH` with the explicit `withdraw` value can initiate an opt-out; final order submission metadata is never consent evidence. If the choice arrives before a server-observed phone, the choice is staged for at most four minutes in the same Woo session and is applied only after a verified Store API billing update. The current Cart-Token/nonce, checkout key and login/session fingerprint are checked again.
- Simultaneous GRANT checkbox selection and withdrawal are **rejected**, not resolved by guessing. A previously recorded preference or a plain phone match never fabricates a new GRANT or REVOKE.

Both action types reuse the already approved `woo.whatsapp-consent.v1` transport. The server maps an explicit withdrawal to `REVOKE` with canonical API field `moda/whatsapp-checkout-recovery`, `selection=UNCHECKED`, a freshly generated idempotency ID and the current server-observed phone. This records current `CustomerPhone` permission and immutable evidence *only after* hosted API acceptance. Repeated draft updates and duplicate retries do not generate additional events from the same observed checkout choice. The hosted API is responsible for tenant isolation, ambiguous matches, revision monotonicity, evidence durability and the separate `CUSTOMER_STOP` restriction.

The plugin never claims success before an API acknowledgement. If the API is unavailable, the checkout remains usable; the request remains unacknowledged, with an unchanged retry event ID. A short-lived non-identifying WordPress transient permits already scheduled retries; successful ACK, a terminal rejection, or a detected phone/session/login change invalidates that permit. Missing/expired retry permits fail closed. WordPress login/logout hooks invalidate pending session observations. This is an expiry for **replay authorization**, not a consent-expiry rule.

An authenticated new checkout can grant or withdraw again, but a changed phone or WordPress/Woo session cannot inherit an old affirmative checkbox or queued event. A grant after an earlier withdrawal is valid only after a **new explicit** checkbox selection. A later decision **never** restarts abandoned carts or queues a consent-triggered recovery re-evaluation; the next ordinary checkout event, if any, has its own independent eligibility and current-consent check. No automatic clearance of WhatsApp STOP is attempted.

## Validation ownership

Woo repository unit/contract tests verify the explicit default/withdraw choice, valid session and Cart-Token, stale login/phone handling, installation/feature denial, lost-ACK and retry identity, and 20-locale source coverage. They **do not** prove real Woo page/checkout behavior or hosted persistence.

All LocalWP Classic/Blocks, HPOS, returning guest/account, multiple devices/tabs, disclosure rendering, actual pre-submit API/PostgreSQL ACK ordering and STOP-vs-consent behavior are deferred to terminal `ARCH-046-SYSTEM-TEST-001` (and system test 002 when live recovery exists). No LocalWP run is required for WOOCOMMERCE-003 implementation review.
