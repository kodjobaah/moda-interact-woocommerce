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
| Live Chromium | `tests/integration/scenarios/checkout-consent-browser.mjs` | WooCommerce Blocks hydrates one checkout-fields checkbox; deliberate UI GRANT and confirmation-based REVOKE work without order placement |
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

- Existing saved Woo Blocks checkout generates exactly one real parsed Moda
  Checkout Fields child, with no obsolete directly mounted React placeholder.
- Classic checkout emits its native checkbox/status control and does not publish
  a grant from an unchecked page refresh.
- Real `cart/extensions` calls carry Woo session/nonce/cart state and return
  the correct request-local CartSchema extension metadata; no protected proof
  or installation secret appears in the browser's response.
- Explicit GRANT sends the exact six-field `woo.whatsapp-consent.v2` request,
  acknowledged by the stand-in before the UI declares it recorded.
- Proof-backed `status` reads without any consent write; proofless second
  guests and phone mismatches cannot use another shopper's grant.
- Checkbox unchecking and unconfirmed withdrawal are inert; separately
  confirmed withdrawal sends REVOKE with a new event ID.
- Replaying an old GRANT request ID after REVOKE never creates another write.
- HTTP 503 on a write or proof read does not claim durable permission.
- A returning logged-in shopper can use their own proof, not another person's
  proof, and consent does not schedule checkout recovery activity.
- Opt-in Chromium run verifies actual React rendering, an unchecked initial
  state, a deliberate click and an explicit confirmation before REVOKE.


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
