# Moda Interact for WooCommerce

Moda Interact is an installable WordPress plugin with a React application inside
WooCommerce Admin. Its PHP runtime makes authenticated server-to-server requests
to Moda Interact when an administrator connects the store or opens the connected
merchant Overview. It does not run a separate Node server on the merchant site.

The plugin uses the official WooCommerce `create-woo-extension` template and the
WordPress Scripts build system. Production assets are generated into `build/` before
packaging; source code remains in `src/`. The Admin Overview reads authenticated
merchant state through the PHP plugin and does not run a separate Node server.

## Requirements

- Node.js and npm selected by the workspace `.nvmrc`.
- PHP, Composer, Docker and a running Docker daemon on the host.
- Supported runtime: WordPress `7.0` and `7.1`, PHP `8.1+`, and WooCommerce
	`11.0` and `11.1`.
- The current validation environment pins WordPress `7.1.2`, WooCommerce `11.1.2`
	and container PHP `8.1`.

## Runtime Compatibility

WordPress plugin headers declare the native requirements: WordPress `7.0`, PHP
`8.1`, and the `woocommerce` plugin. The runtime remains inert unless active
WooCommerce is version `11.0` or later. Unsupported or missing WooCommerce is
reported only to administrators who can activate plugins. WooCommerce-dependent
Admin setup waits for the public `woocommerce_init` hook and runs once per request.

The deterministic `wp-env` matrix is:

| Matrix | WordPress | WooCommerce | Container PHP |
| --- | --- | --- | --- |
| Minimum | 7.0.6 | 11.0.1 | 8.1 |
| Current | 7.1.2 | 11.1.2 | 8.1 |

Run the minimum matrix on a separate port so it can coexist with the current
environment:

```sh
WP_ENV_PORT=8892 npm run env:start:minimum
WP_ENV_PORT=8892 npm run env:stop:minimum
```

The default `npm run env:start` / `npm run env:stop` commands use the current
matrix from `.wp-env.json`.

Before Node, PHP, Composer, Docker or wp-env commands, source the workspace bootstrap
from this repository:

```sh
export MODA_WORKSPACE_ROOT="/path/to/moda-interact-workspace"
source "$MODA_WORKSPACE_ROOT/scripts/bootstrap-woocommerce.sh"
```

## Setup And Development

```sh
npm ci
npm run install:php
npm run start
```

`npm run start` watches and rebuilds assets. For one production build, use
`npm run build`.

## Checks And Tests

```sh
npm run lint:js
npm run lint:css
npm run lint:php
npm run test:js
npm run test:php
```

## Local WordPress And WooCommerce

```sh
npm run env:start
```

Open `http://localhost:8888/wp-admin/` and sign in with the wp-env development
account (`admin` / `password`). The Moda Interact page is available from the
WooCommerce Admin navigation at `/moda-interact`.

Stop and remove the local environment with:

```sh
npm run env:stop
```

## Admin Shell Extension Boundary

The `/moda-interact` page presents the connection section and, only while
connected, the real Overview backed by the authenticated merchant bootstrap API.
Later merchant screens may be added only when their owning task has implemented
the capability and its accepted local API boundary. Unimplemented screens must
not be registered or exposed as navigation destinations.

The connection section consumes only the local WordPress REST connection
routes. `CONNECTED` confirms installation authentication only; it does not
represent merchant onboarding, billing, entitlement, or business-feature state.
The Overview separately displays the shared onboarding milestone, active and
pending Store Category projections, and provider-neutral store international
context. It is read-only: this plugin screen does not complete onboarding,
change a category, or write store locale/time-zone/country values.

## Moda API Connection Boundary

The PHP runtime reads `MODA_INTERACT_API_BASE_URL` from server-side environment
or `wp-config.php`; it is not exposed to Woo Admin JavaScript. Public mode is the
default and requires an HTTPS DNS origin. `MODA_INTERACT_CONNECTION_MODE` may be
set to `local-development` explicitly for local testing; that mode accepts only
approved local API and WordPress origins and must not be enabled by browser input.
An optional server-side `MODA_INTERACT_API_CA_BUNDLE` path adds a test CA while
TLS verification remains enabled.

Run the real WordPress REST and HTTPS API fixture flow with:

```sh
npm run test:integration:wordpress
```

The runner starts `wp-env`, provisions a temporary HTTPS fixture certificate,
exercises the public one-attempt challenge and privileged cookie/nonce routes,
the authenticated `/v1/merchant/bootstrap` HTTPS fixture and privileged local
WordPress REST route, and removes its CA fixture and WordPress environment on completion. Connection
responses are limited to status and non-secret installation metadata. Bootstrap
secrets, the long-lived installation credential, and Authorization headers stay
inside PHP and the server-side WordPress option.

## Plugin Package

Create and audit `moda-interact.zip` with:

```sh
npm run package:production
```

The command rebuilds production assets, installs only production Composer
dependencies, and runs the official WordPress Scripts plugin packager. It checks
version consistency, required runtime files, archive paths, production Composer
contents and bounded runtime/API-origin disclosures. The ZIP uses the
`moda-interact/` plugin root and excludes development sources, tests, local
environment state, Node dependencies and Composer development executables.
Because packaging materializes production-only Composer dependencies, run
`npm run install:php` to restore PHPUnit before further PHP tests.

Regenerate the WordPress translation template while the wp-env CLI container is
available with `npm run i18n:makepot`; it extracts the `moda-interact` domain from
the plugin source into `languages/moda-interact.pot`.


## Admin interface localization (ARCH-026-WOOCOMMERCE-009)

Locale selection is WordPress-native: the signed-in administrator's interface
language takes precedence; the site language is used when no override exists.
This does not update the shop's stored locale or customer conversation language.

Run `npm run i18n:makepot` against a running wp-env to generate the source-only
gettext template. Reviewed locale source `.po` files go in `languages/`.
`npm run i18n:compile` creates handle-specific JavaScript JSON and PHP `.mo`
assets; plugin packaging recompiles these automatically. Until the final WOO-014
coverage gate, missing locale batches are allowed, but supplied catalogues
must be complete. `npm run i18n:verify:20` enables the final strict gate.
See `languages/README.md` for the translation-batch contract.

### Merchant Knowledge WordPress proxy (ARCH-035-WOOCOMMERCE-014)

All `moda-interact/v1/merchant/feature-preferences` and
`moda-interact/v1/merchant/merchant-knowledge` WordPress routes require
`manage_woocommerce`, a valid `X-WP-Nonce` REST nonce, an active connected
installation and the unchanged canonical site identity. The server, never
browser JavaScript, sends the installation credential to the authenticated
Moda API-014..017 endpoints. Responses are bounded, schema-validated and
`Cache-Control: private, no-store`; failure responses never reflect hosted
payloads or signed URLs.

File transport uses the 17 October ARCH-035 **browser-direct** amendment:

1. `POST /wp-json/moda-interact/v1/merchant/merchant-knowledge/upload-intents`
   accepts only JSON metadata: `idempotencyKey` (UUID), `purposeKey`,
   `dataFormatKey` (`CSV` or `XLSX`), `originalFileName`, `contentType`,
   `sizeBytes`, `sha256` (lowercase SHA-256). PHP obtains a version-1 presigned
   capability from the hosted API and validates its exact approved destination,
   shop-bound object path, TTL and signed headers before handing the URL/headers
   to the authenticated administrator in a **no-store** response.
2. **Browser (WOOCOMMERCE-015)** sends a Blob directly to the *unmodified* R2
   HTTPS S3 API URL using `PUT`, exactly the supplied `requiredHeaders`,
   `credentials: 'omit'` and `redirect: 'error'`. No WordPress cookie, REST
   nonce, Moda installation credential or additional upload headers are sent.
   WOO-014 does not handle, buffer, proxy or persist any binary bytes. R2 CORS
   is separately configured for approved site origins by GATEWAY-001; it is
   not bypassed using PHP.
3. Only after a successful PUT may the browser call
   `POST /wp-json/moda-interact/v1/merchant/merchant-knowledge/upload-finalize`
   with JSON metadata (`assetId`, `purposeKey`, `name`, `languageTag`,
   `contentType`, `sizeBytes`, `sha256` and optionally `sourceId`). The API
   independently verifies actual object contents before accepting the revision.
   A successful intent or PUT alone does **not** create an active source.

WordPress requires only two **non-secret** deployment configuration values to
pin the approved R2 destination: `MODA_MERCHANT_KNOWLEDGE_R2_ENDPOINT`, set to
`https://<32-hex-account>.r2.cloudflarestorage.com`, and
`MODA_MERCHANT_KNOWLEDGE_R2_BUCKET`, set to the exact approved bucket. These
must match the hosted API's sealed database `merchant.knowledge.r2` settings;
missing/mismatched WordPress values cause the intent handoff to **fail closed**
without preventing knowledge reads/edits. WordPress does not need the R2 key,
secret, max-upload setting, PHP cURL or writable upload directory. If the
hosted R2 account/bucket is rotated, update the WordPress approved destination
before new browser uploads; already-issued capabilities are not a fallback.

WordPress rejects multipart/file-body submissions (including the obsolete
`/merchant-knowledge/upload` route), unknown signed hosts and malformed
responses. Signed capabilities must not be logged, cached, persisted or placed
in page URLs. On failed/preflight-denied/aborted/redirected R2 PUT, the browser
must not call finalise or assert upload success. The authorised user can retry
using the API's documented idempotency and expiration behaviour.
