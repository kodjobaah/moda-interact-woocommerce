# ARCH-049: WooCommerce native ShopBrand publication

The WooCommerce plugin publishes a complete `woo.shop-brand.v1` observation to
`POST /v1/woocommerce/shop-brand` on the **hosted Moda API**. It creates **no
new public WordPress REST route**, R2 upload or database connection. The caller's
installation is authenticated using the same local `InstallationStore` record
and `ModaApiClient` bearer/installation headers as other hosted Woo commands;
`shopId` and installation credentials are never present in the snapshot body.

## WordPress source and supported versions

- Supported plugin baseline: WordPress 7.0+ and WooCommerce 11.0+ (matching
  plugin headers). `get_theme_mod('custom_logo')` is the source for a
  classic theme. The native `site_logo` option is the source for a block theme.
  Both are attachment IDs, resolved with core image URL and metadata functions.
- Site title comes from `get_bloginfo('name')`; Site Icon from the `site_icon`
  attachment ID and `get_site_icon_url()`. A missing/deleted image or an HTTP
  URL is explicitly published as `null`; no HTTP-to-HTTPS URL rewrite occurs.
- `coverImage` is always `null`: WordPress has no standard cover-image setting.
  No theme-file scraping, theme-specific plugin settings or storefront scanning.
- No automatic publication occurs when WordPress branding changes. A later
  explicitly requested capture reads a **complete current snapshot**, including
  `null` when the merchant has removed a logo or icon.

## Asynchronous delivery and recovery

- Plugin activation before a Moda connection cannot publish: it has no
  installation credentials. **The first successful connection** queues the initial
  capture without waiting for the hosted API. For stores connected before this
  feature is installed, the first initialized runtime queues the initial capture.
  The bootstrap marker records only the installation ID (with WordPress autoload
  disabled) after **enqueue acceptance**, not after delivery success.
- No daily reconciliation job and no hooks watching Site Identity, theme or
  attachment changes. ShopBrand reconciliation has **never been deployed**, so
  no legacy Action Scheduler cleanup, migration marker or recurring-job lookup
  is required. Bootstrap waits for `action_scheduler_init` and also runs if the
  scheduler initialized before the Woo runtime registered its callback.
- A future authorised merchant **Sync branding** action can invoke
  `ShopBrand\Publisher::requestSync()`. It uses the same coalesced async capture,
  without a second HTTP or image-processing implementation. The merchant UI,
  nonce/capability-gated controller and last-sync display are not part of this task.
- Each capture produces a deterministic `eventId` from installation ID and the
  canonical source JSON. Its UTC `observedAt` is created once per snapshot and
  passed unchanged through retries. The API orders/deduplicates observations;
  the plugin never grants authority to caller-supplied `shopId`.
- Retry transient transport/408/429/5xx errors after 20 seconds, 60 seconds,
  5 minutes and 15 minutes (five attempts including the initial attempt).
  Definitive 4xx stop. Malformed 200 responses are retried idempotently.
- A retry aborts if the installation ID/shop ID changes or the canonical site URL
  differs from the locally recorded URL. Reconnecting the same installation does
  **not** re-sync branding; a genuinely new installation receives its own initial
  capture. Obsolete credentials are not retained in queued actions.
- Action Scheduler is a WooCommerce dependency. If initial enqueue fails or is
  unavailable, do not record the bootstrap marker; a future runtime initialization
  can retry the initial enqueue once the scheduler is available. Bounded
  publication retries continue after a successful enqueue. A final failure is
  logged, **not** represented as delivery success; it does not activate a periodic
  re-sync. Merchant WordPress Action Scheduler tables retain queued snapshot
  metadata but never installation credentials.

## Deployment dependency and diagnostics

Enable the hosted `POST /v1/woocommerce/shop-brand` route (ARCH-049-API-001)
**before** activating real end-to-end brand publication. The Woo code can be
validated independently using stubbed WordPress data and an authenticated fake
HTTP transport, but a live hosted API acceptance test is deferred until API-001.
The endpoint returns JSON `{ "status": "updated" }` or
`{ "status": "unchanged" }` after its database commit.

This PHP plugin cannot import the Node-only
`@modainteract/moda-interact-shared/logging` entrypoint. The publisher uses the
existing WooCommerce logging interface (`wc_get_logger`) for bounded semantic
failure categories and numeric HTTP status only. If the Woo logger is not
available, WordPress/PHP `error_log` receives the same bounded code. Log messages
never contain source URLs, payloads, secrets or exception messages.

## Integration test coverage (revised task definition)

Run against a **disposable**, Docker-backed wp-env installation with the
repository's Composer/npm development dependencies and WordPress/WooCommerce
versions declared in `.wp-env.json`:

```sh
npm run test:integration:shop-brand
```

The focused runner starts and stops its own WordPress environment, configures a
local TLS fixture with a temporary trusted CA, exercises the existing connection
REST endpoint to obtain real installation credentials, and invokes Action
Scheduler using WP-CLI. It creates native attachment records and changes
WordPress Site Identity settings rather than calling the PHP source reader
with mocked globals. Its assertions cover:

- initial connection capture, first upgrade bootstrap, one-time enqueue markers,
  no recurring brand actions and no capture on branding changes;
- actual authenticated `POST /v1/woocommerce/shop-brand` request headers,
  exact payload, stable digest, positive attachment dimensions, and no `shopId`;
- successful `updated`/`unchanged` responses after explicit `requestSync()` calls;
- no automatic publication on title/logo/icon/attachment changes and no
  recurring brand actions;
- explicit `null` for deleted/removed icon/logo and non-HTTPS sources;
- 503/429 backoff with durable retry payload and unchanged `observedAt`;
- permanent 400 rejection and suppression of stale-installation retries;
- absence of a public shop-brand WordPress route or synchronous settings-call
  network publication; initial bootstrap waits for the initialized Action
  Scheduler store.

The existing complete WordPress suite (`npm run test:integration:wordpress`)
includes the same scenario. The deterministic fixture contract can also be
checked without Docker:

```sh
node --test tests/integration/wordpress-api-fixture.test.mjs
```

**Scope of evidence:** The local HTTPS fixture verifies the Woo producer
boundary; it is not a substitute for the separately owned hosted API-001
PostgreSQL transaction tests or the final ARCH-049 system test. Running this
suite mutates test-only WP options/attachments; do not point it at a live store.
