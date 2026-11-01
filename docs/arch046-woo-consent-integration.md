# ARCH-046-WOOCOMMERCE-003: Checkout consent integration validation

These checks extend the **existing** WooCommerce WordPress integration harness.
They do not replace the PHPUnit, i18n and Node tests or the architecture-owned
terminal system tests.

## Coverage and boundaries

| Layer | Test | What it actually proves |
| --- | --- | --- |
| PHPUnit | `tests/CheckoutConsent*.php` | PHP capture/proof/Store API decisions with test doubles |
| Node | `tests/integration/consent-api-fixture.test.mjs` | Exact six-field v2 payload, fixture ACK/revoke, response validation |
| Live WordPress HTTP | `tests/integration/scenarios/checkout-consent-wordpress.mjs` | Installed plugin and real WooCommerce Classic AJAX and Cart Store API drive the checkout consent code; authenticated PHP sends HTTPS requests to a controlled Moda stand-in |
| Live Chromium | `tests/integration/scenarios/checkout-consent-browser.mjs` | WooCommerce renders one native contact-information checkbox; a deliberate check/uncheck uses proof-backed GRANT/REVOKE without order placement |
| Hosted API integration | **Not yet certified by this patch** | The actual architect-accepted API-006 proof/STOP decision and API-007 v2 write, backed by the hosted database, must be independently exercised |

The HTTP fixture validates server-to-server headers, schema/version, shopper-bound
proof requests, acknowledgement and duplicate/revocation handling. It cannot
establish real hosted persistence, tenant-authorisation decisions, independent
STOP enforcement or cross-repository background/messaging isolation.

## Run on a disposable test site only

Requires Docker, `wp-env`, WooCommerce, Node/WordPress build dependencies and
Composer dependencies. The full harness creates WordPress users, products and
orders, changes checkout settings, and starts/stops its test site. **Do not run
against a merchant or development store containing valuable data.**

```sh
npm ci
composer install
npm run build
npm run test:js:node
composer test
npm run test:integration:wordpress
```

The standard full WordPress runner now includes the ARCH-046 live consent HTTP
scenario. It sets up an HTTPS test API and connects the test installation.

Attempt 4 includes the JavaScript formatting changes reported by the project
ESLint/Prettier check, including the merged ARCH-048 scenario files. Verify them
with the actual WordPress toolchain installed; the generated patch is not evidence
that lint passed in your local environment:

```sh
npm run lint:js
```

If checkout tests were modified again after patch application, correct new lint
reports in those files rather than ignoring the gate or formatting unrelated
application code.


To run just the consent scenario against **an already running, disposable wp-env
fixture** with both plugins active and installation ID `install_wp_fixture`,
credential version 2:

```sh
MODA_CHECKOUT_TEST_DISPOSABLE=1 npm run test:integration:consent
```

This entry point checks the installation fixture identity before mutating test
data, and restores the original checkout page option after the test. Existing
checkout activities may remain in the disposable test database.

For real browser hydration and action coverage, install Chromium for Playwright
once, and run the opt-in browser variant against that same disposable fixture:

```sh
npx playwright install chromium
MODA_CHECKOUT_TEST_DISPOSABLE=1 npm run test:integration:consent:browser
```

Alternatively, `node tests/integration/run-wordpress.mjs --consent-browser`
includes the browser assertion in the **full, freshly managed** WordPress
integration run. Browser dependencies are not pulled into the ordinary Node
unit-test command.

## Required assertions

The live scenario fails unless all of the following hold:

- The saved Woo Blocks checkout displays exactly one native optional Contact Information checkbox through the Additional Checkout Fields API, without any custom block or merchant template edit.
- Classic checkout emits its native checkbox/status control and does not publish
  a grant from an unchecked page refresh.
- Real `cart/extensions` calls carry Woo session/nonce/cart state and return
  the correct request-local CartSchema extension metadata; no protected proof
  or installation secret appears in the browser's response.
- Explicit GRANT sends the exact six-field `woo.whatsapp-consent.v2` request,
  acknowledged by the stand-in before the UI declares it recorded.
- Proof-backed `status` reads without any consent write; proofless second
  guests and phone mismatches cannot use another shopper's grant.
- Only a deliberate uncheck of verified existing permission sends authenticated REVOKE. Ordinary Woo field updates, status hydration, and stored field values never publish consent.
- Replaying an old GRANT request ID after REVOKE never creates another write.
- HTTP 503 on a write or proof read does not claim durable permission.
- A returning logged-in shopper can use their own proof, not another person's
  proof, and consent does not schedule checkout recovery activity.
- Opt-in Chromium checks the actual native Woo checkout checkbox: initial verified state,
  immediate deliberate selection/deselection, and unchanged visual choice despite
  a GRANT/REVOKE rejection. A failed write leaves the previously persisted Moda
  decision unchanged (or unconfirmed if the request outcome is ambiguous). No
  button, popup or technical error appears.


## Test recipient vectors

The live consent scenario uses `+447400123456`, the accepted GB recipient
from `tests/fixtures/identity-v1.shared-2.5.0.json`. It separately checks
that the Ofcom drama-range `+447700900001` cannot create consent. The original
Attempt 3 fixture inadvertently used the **rejected** drama number as its
positive GRANT input, resulting in a false-negative Classic checkout assertion
(`0 !== 1`). Do not relax phone validation or the HTTPS GRANT assertion to
make that test pass. No real WhatsApp delivery is performed by the fixture.

## Open integration gates

The status endpoint currently used by the Woo client is the **provisional
Woo-side contract**. The attached architecture marks ARCH-046-API-006 as
unmaterialised and API-007 as requiring acceptance/deployment. Do **not** mark
WOOCOMMERCE-003 or the architecture Complete on the basis of these simulated
hosted responses. Once those API tasks are accepted, run an additional
cross-repository test against the actual API implementations and authoritative
CustomerPhone/STOP evidence; terminal certification remains owned by the
ARCH-046 system-test tasks.

Record any live browser, HTTP or hosted failures in the WOO-003 Completion
Report. Do not silently turn missing Docker, missing Chromium or an unavailable
hosted service into a green test.

## Classic session transport correction (Attempt 5)

The original Classic `POST /wp-json/moda-interact/v1/checkout-consent/status`
returned HTTP 401 for a genuine Woo checkout. The generic WordPress REST route
does not necessarily have `WC()->session`, even when the browser supplies the
checkout cookie. The consent code correctly refused to create a fresh session
but therefore could not read the shopper's grant proof.

Classic now uses WooCommerce's own `wc-ajax` hooks for **status** and **withdraw**.
The checkout page provides the two Woo-generated URLs and an explicit nonce.
The client sends a same-origin `POST` with the nonce and current form; the server
checks the nonce and existing Woo session before touching proof or hosted API.
No custom REST checkout-session bootstrap, browser-to-Moda call, extra React
renderer or arbitrary phone-based lookup is introduced. Blocks continues to
use its Store API `cart/extensions` integration without change.

The real WordPress test now rejects a forged Classic withdrawal nonce and
asserts the actual Woo session carries proof from GRANT through status/REVOKE.
Run both HTTP and opt-in browser variants before acceptance.

## Checkout activity isolation (Attempt 6)

The Attempt 5 full WordPress run passed Classic status and reached the Blocks
consent flow, but a global **pending** Action Scheduler count changed from 52
to 53. That count alone cannot establish whether a consent request enqueued a
checkout update: actions from earlier scenarios may run, finish or retry while
the test is executing.

The integration scenario now inspects `readCheckoutActionHistory()` across all
Action Scheduler statuses. It compares **event IDs**, not scheduler row counts,
and selects `CHECKOUT_UPDATED` events for the disposable scenario's unique
product. An action retry carrying the same event ID is not mistaken for a new
checkout snapshot; a newly created event ID for that product still fails the
consent-isolation requirement, even if the action already completed. The failure
reports only action/event IDs (no phone, billing contact or checkout payload).

The Blocks scenario checks isolation after initial STATUS, after explicit GRANT,
and after the full withdrawal sequence, making a real regression easier to
locate. It also checks separate guest and returning-account consent actions.
The Classic scenario retains the same rule after its checkout review and consent
operations. Focused Node tests protect the event-selection and retry semantics.

**This is test-scope and diagnostic correction, not proof that the prior 53rd
action was unrelated.** Rerun `npm run test:integration:wordpress` on a disposable
WordPress instance. If the scoped assertion fails, inspect the reported
checkout event ID and correct the responsible runtime behaviour before
accepting WOO-003; do not remove the assertion or suppress legitimate checkout
capture from real cart or billing changes.

## Attempt 7: consent-only checkout-key isolation

WooCommerce's `POST /wc/store/v1/cart/extensions` recalculates cart totals **after**
executing the consent callback. Before this correction, a GRANT minted a shared
`CheckoutKey`; `CheckoutCapture::captureExisting()` treated that key as evidence
of recovery checkout activity, emitting `CHECKOUT_UPDATED` from consent alone.
The real WordPress integration test caught this with a new event ID after Blocks
GRANT. Do not weaken its durable Action Scheduler assertion.

The fix distinguishes **a consent-only key** from an **observed checkout**. A
consent-created key retains shopper/session/proof binding but cannot start
checkout publication via cart total recalculation or cart/customer refresh.
The existing explicit Classic checkout / Blocks draft hooks may promote the
same key **only after** a checkout snapshot is durably enqueued. Failure to
schedule leaves the consent-only guard intact. A genuine checkout continues to
publish ordinary cart updates and order events with the unchanged key.

Run `vendor/bin/phpunit tests/CheckoutCaptureTest.php` and
`vendor/bin/phpunit tests/CheckoutConsentStoreApiTest.php`, then the actual
`npm run test:integration:wordpress` suite. Confirm the live Blocks GRANT
no longer creates a new `CHECKOUT_UPDATED` event, and that ARCH-035 still
publishes updates after a real checkout. Docker/wp-env and hosted API-006
certification remain separate gates; the PHP regression alone does not prove
live WooCommerce compatibility. No API-006 or API-007 contracts are altered.

## Attempt 8: consistent checkout eligibility and bounded rendering diagnostics

The disposable WordPress consent-only run reached the checkout pages, but one
run lacked the parsed Blocks consent child, and a separate browser-enabled run
lacked the Classic checkbox. Those results happen **before** GRANT/REVOKE and
do not establish whether Attempt 7's checkout-activity guard is effective.

Page construction invokes multiple Woo hooks: Classic field registration,
Classic asset enqueue and Blocks field/asset registration. These hooks share
one `CheckoutConsentEligibility` instance and one memoized **local-only**
presentation decision per PHP request. The display check verifies the locally
configured installation and current site URL; it does not call the hosted
feature-preferences API or perform DNS resolution. A connected checkout can
therefore show the **unchecked** consent field even when the hosted API is
slow or temporarily unavailable. Missing/invalid installations and local
canonical-site mismatches still fail closed for presentation.

This is **not consent authorisation**. A locally valid installation does not
prove the hosted feature is enabled or the plan is eligible. Capture's actual
GRANT command continues calling `eligible()` to fetch the current authenticated
`checkout_recovery` decision, and the hosted API/recovery worker must remain
authoritative. If a feature is disabled while the local site is still connected,
the display-only checkbox may be visible, but checking it cannot create consent.
Never interpret WooCommerce's saved checkout-field value as permission.
A failed hosted lookup is logged internally, never shown as an error banner or
checkout notice. A remote outage must not block rendering, payment or order
submission. A future server-pushed/local feature snapshot would be needed to
hide a disabled feature reliably *without* a synchronous remote read.

When consent HTML assertions fail, the Node integration runner now reports
only bounded signals (whether Classic/Blocks scripts, the status configuration
and Checkout Fields are present) and the count of authenticated feature fixture
reads for that page request. It no longer embeds raw checkout HTML or nonces in
an `AssertionError`. Use these signals to distinguish a fail-closed feature
read from a parsed-Blocks insertion/rendering problem. The test still fails
unless the actual Classic field and exact single Blocks child are emitted.

Run `MODA_CHECKOUT_TEST_DISPOSABLE=1 npm run test:integration:consent`
and then `MODA_CHECKOUT_TEST_DISPOSABLE=1 npm run test:integration:consent:browser`
against the disposable wp-env setup. Neither the browser hydration nor the
hosted API-006 integration can be accepted solely from isolated tests.


## Attempt 11: diagnose missing Classic form without changing consent logic

The HTTP consent suite now temporarily installs
`tests/integration/checkout-consent-test-probe.php` as a mu-plugin **only on the
explicitly disposable wp-env site**. It is removed by the scenario's `finally`
block. The page request supplies a test-only header; the probe emits a bounded
HTML comment with PHP cart count, presence of the saved Classic shortcode, and
whether Woo's pre-checkout and pre-form hooks ran. No cookies, nonces, session
IDs, phone numbers, customer addresses, cart items, or raw HTML are logged.

If Classic checkout still lacks its form, the assertion reports these signals:

- `phpCartCount: 0` with `shortcodeEntered: true` indicates the PHP shortcode
  reached Woo's checkout handler with an empty cart (which may return silently).
- `hasClassicShortcode: true` and `shortcodeEntered: false` indicates that the
  saved page has the shortcode but the handler was not executed on this request.
- A nonempty PHP cart and `shortcodeEntered: true` narrow the cause to Woo's
  checkout template/error/registration path rather than cart bootstrap.
- `probePresent: false` means the test probe was not emitted; investigate the
  disposable fixture/WordPress footer before drawing cart conclusions.

The probe is diagnostic only. It does **not** alter checkout templates, create
cart items, override the empty-cart guard, bypass consent eligibility or weaken
any integration assertion. Rerun `MODA_CHECKOUT_TEST_DISPOSABLE=1 npm run
test:integration:consent` and use the signals to determine the next correction.


## Disposable storefront visibility (Attempt 12)

WooCommerce 9.6+ can default newly installed stores to **Coming Soon**
visibility. In that mode, a guest checkout page may return HTTP 200 and load
Moda scripts while its usual checkout content is replaced by the Coming Soon
template. The WordPress HTTP consent scenario therefore records and temporarily
sets `woocommerce_coming_soon=no` for the **disposable fixture only**, restoring
the previous value on exit (including an absent option). It does not change
merchant-store visibility or production Moda code.

If the Classic form is still absent, the probe reports bounded booleans for
shortcode registration, page-content filtering, WooCommerce shortcode callback
and output, as well as existing cart and checkout hook signals. These distinguish
a replaced WordPress page template from a missing shortcode callback without
printing page HTML, nonces or shopper information.


## Attempt 17: native Blocks checkbox and explicit consent authority

Attempt 16's live comparison returned `neither_renders`: both a runtime-injected
and a saved Checkout Fields child were registered but did not hydrate. That
custom-block mechanism has been **removed**, including the renderer, block
metadata, editor registration, and temporary comparison harness. The current
implementation registers one optional WooCommerce Additional Checkout Field,
`moda-interact/whatsapp-recovery-opt-in`, in `contact` for Blocks checkouts.
Classic checkout remains a separate WooCommerce-native checkbox.

Registration happens during `woocommerce_init`, before Woo builds its native
checkout field definitions, including the Store API route. The browser does not
need the merchant to edit, save or migrate a checkout page. On disabled or
ineligible stores, frontend registration fails closed; no native field is
registered for a Classic checkout. A checkout API request registers the optional
field without querying the hosted feature service in the payment/order path.

**The native field is only a presentation surface.** Its WooCommerce-saved
value is always sanitized to false. A field update, draft order update, cart
update, checkout POST or automatic React render can never GRANT or REVOKE. A
trusted, deliberate browser checkbox click instead invokes the existing
session-authenticated `cart/extensions` `choice` / `withdraw` command. The checkbox follows the latest deliberate click immediately, without waiting
for GRANT/REVOKE acknowledgement or disabling the input during requests. The
frontend keeps `localChoice` (display) separate from proof-backed `verified`
(hosted consent). A successful GRANT still requires a proof-backed effective
status read for verified permission; a successful REVOKE updates the server
state. A rejected GRANT leaves the UI checked but cannot create permission; a
rejected REVOKE leaves the UI unchecked but cannot remove a prior grant. An
ambiguous transport outcome is not evidence of either success or failure and
must be reverified on a subsequent checkout read. A change from an established phone to a different phone clears the
old local choice without sending a new action. A deliberate choice made
*before any phone is available* stays visually selected during the first
billing-phone entry and Woo re-renders. That earlier visual choice is not
silently published as a GRANT when the phone appears: publishing requires a
fresh deliberate checkbox check with the current phone established. A
returning guest in a different browser/incognito session has no local
shopper-bound proof, even if Woo restores their address; only the accepted
API-006 proof-backed status may check their control. Neither path displays
an error, popup, confirmation button or operational message on the merchant
storefront; PHP failures use the internal structured diagnostic boundary.

A user changing billing phone or refreshing checkout cannot automatically send
GRANT/REVOKE. The observer reconciles the native checkbox after WooCommerce
re-renders its checkout, without dispatching a checkbox change event. This is
especially important because WooCommerce persists Additional Checkout Fields as
ordinary order/customer data; those values must **never** become the durable
Moda WhatsApp consent decision.

Live acceptance on a disposable WordPress/WooCommerce site:

```sh
npm run test:js:node
composer test
npm run lint:js
npm run build
MODA_CHECKOUT_TEST_DISPOSABLE=1 npm run test:integration:consent
MODA_CHECKOUT_TEST_DISPOSABLE=1 npm run test:integration:consent:browser
```

The browser run must demonstrate an actual visible native field for both
checkout modes and one authenticated GRANT and REVOKE after deliberate clicks,
with no consent activity from status hydration or ordinary field submission.
The controlled HTTPS fixture is **not** evidence that the real API-006 / API-007
hosted contracts and STOP decisions have been independently verified.

## Attempt 18: early native field registration and eligibility diagnostics

The native Additional Checkout Field must be registered at `woocommerce_init`
(before WooCommerce constructs checkout or Store API field definitions).
`wp` and `rest_api_init` are too late to depend on for a frontend field. The
WooCommerce runtime itself starts during `woocommerce_init`, so the consent
registration runs immediately if that action is already in progress, or attaches
once for the action if bootstrapped earlier.

At this early stage `is_checkout()` and `has_block()` are not authoritative.
To avoid hosted API requests during checkout rendering, registration compares the
incoming URL to the configured Woo checkout permalink (including direct
`?page_id=` checkout requests) and checks the locally configured installation.
The request-scoped presentation decision is reused by subsequent presentation
hooks; GRANT admission still revalidates the current feature state remotely.
An offline hosted API must never prevent the checkbox from appearing for a
locally configured installation. Woo Store API cart and
checkout routes register the identical *display-only* field without a hosted
feature read. Neither stored Woo field values nor a local installation record
can grant WhatsApp permission.

If a locally configured checkout still lacks the checkbox, inspect
**WooCommerce > Status > Logs** for source `moda-interact-consent` and the fixed
`eligibility_*` event codes. Missing/invalid installation and canonical-site
mismatch can suppress the *display*. Hosted feature response invalid, disabled
feature, ineligible plan and upstream failure must suppress new GRANTs, but
must not suppress the optional checkbox on checkout page load. The domain/credential, customer
phone, proof, API payload and original checkout HTML are never included in
these diagnostics. A canonical-site mismatch may occur when a development
shop changes its Cloudflare tunnel hostname; reconnecting the installation to
its current canonical site may be required. Never bypass that security check.

Re-run `MODA_CHECKOUT_TEST_DISPOSABLE=1 npm run test:integration:consent:browser`
and confirm that the initial Blocks page has both the native checkbox and the
Moda frontend script/config. Confirm the checkbox is unchecked without verified
proof, checked only after a verified grant, and responds to deliberate GRANT
and REVOKE. Browser diagnostic mode alone does not enable field registration.
Do not claim hosted API-006/007 integration is complete from fixture tests.


## Attempt 19: checkout rendering independent of hosted eligibility latency

A valid local installation with a matching canonical WordPress site URL allows
Classic and native Blocks checkbox presentation, even when GET
`/v1/merchant/feature-preferences` times out. The initial page render neither
performs that network call nor performs a DNS lookup. A missing or changed
installation still hides the control without impacting checkout.

All consent mutations remain separately authenticated and authorized; no
locally configured site or Woo checkout field value can grant permission by
itself. Confirm the real hosted API denies GRANT when feature eligibility is
disabled or unavailable.

Validation: both checkout types must render their unchecked control on a
locally connected store with the feature API offline, and the site must still
complete checkout. A later verified status can check the box only with valid
shopper-bound proof; no display-only value may generate a consent event.


## Disposable wp-env port changes and the consent fixture

The focused consent tests reuse a previously connected, **synthetic** WordPress
installation (`install_wp_fixture`, credential version 2). The installation's
`canonicalSiteUrl` is an authorization boundary, not a display preference. If
a disposable `wp-env` site originally connected on `localhost:8888` is later
started on `localhost:8890`, Classic/Blocks consent presentation intentionally
fails closed until that synthetic connection is re-established for the new
origin. Changing `WP_ENV_PORT` does not reconnect an installation.

The consent-only runner verifies both effective WordPress `home_url()` and the
fixture's stored canonical URL against the port reported by `wp-env status`
**before mutating checkout settings or creating test products**. On mismatch
it fails with an actionable, redacted diagnostic rather than an indirect
"checkbox missing" error. The test never rewrites installation credentials,
relaxes canonical-site comparison or exposes those values in logs.

On a disposable test instance, the supported recovery is to run the main
WordPress integration setup at the new port (which reconnects the synthetic
fixture through the normal connection API), then re-run consent-only:

```sh
WP_ENV_PORT=8890 npm run test:integration:wordpress
WP_ENV_PORT=8890 MODA_CHECKOUT_TEST_DISPOSABLE=1 npm run test:integration:consent:browser
```

The first command runs the full integration suite, which may encounter a
separate workstream's failure after connection setup. It must never run against
a real merchant store. Alternatively, use the original fixture port if it can
be freed safely, without deleting or resetting other developers' containers.
