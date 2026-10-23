# ARCH-035-WOOCOMMERCE-017 — LocalWP merchant promotions verification

This is an **execution checklist**, not evidence that a live installation or upstream API was exercised. Complete it against the developer's actual LocalWP environment after API-021 is deployed and an approved merchant installation has connected.

## Preconditions

- Run the plugin from the canonical `task/ARCH-035-WOOCOMMERCE-017` implementation worktree on a supported WordPress/WooCommerce environment.
- Verify `ARCH-035-API-021` is deployed and reachable using the existing authenticated installation credential. Have at least 7 merchant-eligible campaigns and a pre-existing historical grant for the same shop. Do **not** create synthetic purchases or promotional credits in the plugin.
- Use a WooCommerce administrator with `manage_woocommerce`. In a second browser use a user without that capability. Have browser developer tools open on the network panel.

## Connected merchant workflow

1. Open **Moda Interact → Promotions**. Verify the same native navigation, previous Billing/Purchased Credit History routes, and no Woo coupon/discount controls on this page.
2. Confirm the initial loading state, then six real offers or fewer per page, real quantities, descriptions, expiry dates and flags, and independent offer/history pagination. Compare a response with the authenticated hosted read (do not copy credentials into browser tools).
3. Open a second history page; verify the offer page does not reset. Check display dates and grouped quantities with a non-English WordPress administrator language. Verify changing this language does **not** change the Woo store default or customer conversation language.
4. Choose one `selectable && eligible && !exhausted && !previouslyClaimed` campaign. Double-click the selection button and verify only **one PUT** is sent. The PUT must contain only `campaignId` and the `expectedRevision` from the last successful GET. Confirm the current selection and history are updated by a subsequent **GET**, not by optimistic credit increments.
5. Check a locked, exhausted, previously claimed, no-longer-eligible and already selected campaign. Confirm unavailable selections are disabled and cannot alter a credit balance. Verify history statuses **SELECTED, USED, EXHAUSTED, EXPIRED, CLOSED, NO_LONGER_ELIGIBLE, REOPENED** are readable and not rendered as “Unavailable”.

## Security, conflict and failure scenarios

6. Verify another logged-in user lacking `manage_woocommerce`, and a request missing a valid `X-WP-Nonce`, receive 403 without any hosted API request.
7. Use an outdated but originally valid revision from an earlier GET when an administrator changed the selection in another session. Confirm 409 conflict handling reloads the authoritative selection and history; there must be no fabricated success.
8. Intercept the hosted read with a mock fixture containing an extra `shopId`, extra `credential`, an invalid status, or inconsistent grant counts. Confirm the WordPress proxy returns a safe error, not that payload, and the UI does not expose it.
9. While a GET is pending, switch offer/history pages, leave Promotions, and disconnect/reconnect the plugin. Verify stale responses never display a former installation's offers or history. Repeat while a PUT is pending; neither a stale response nor an uncertain response may be presented as a confirmed grant.
10. Rotate the local credential/version or change the site's canonical URL during an in-flight hosted request (in a controlled sandbox). Confirm `RECONNECT_REQUIRED` or `SITE_URL_CHANGED`, no cross-shop data and no leaked token. Restore the original connection before continuing.
11. Exercise hosted 401 (reconnect), 403 (denied), 409 (stale), 422 (ineligible), 500/network timeout (unavailable). Confirm distinct helpful states, safe refresh/reconnect, no automatic PUT retry and no credit multiplication.
12. Confirm responses have `Cache-Control: private, no-store`, and inspect the browser network traffic for **no** hosted bearer credential, installation ID, shop ID supplied by the browser, or client-controlled upstream URL.

## Evidence for architect review

Record the LocalWP WordPress/WooCommerce/PHP versions, API-021 deployment/revision, locale tested, anonymised redacted request/response statuses, one-selection/one-PUT proof, history status screenshots, browser reconnect/permission/security tests, and any failures. Do not include installation credentials, customer phone numbers or tokens. LocalWP, provider and live API checks must be executed by the developer and not represented by unit-test fixtures.
