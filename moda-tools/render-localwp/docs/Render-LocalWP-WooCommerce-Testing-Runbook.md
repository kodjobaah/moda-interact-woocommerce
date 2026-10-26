# ARCH-036 — Reproducible WooCommerce coupon synchronisation with Render Background and local API

**Runbook version:** 1.0 · **Validated scenario:** 15 October 2026 · **Audience:** developer testing a disposable WooCommerce Sandbox in LocalWP.

*** MAKIING SURE YOU DO THS..TO RESET***
```code
wp option delete moda_interact_woocommerce_connection
```

This runbook reproduces the successful end-to-end topology:

```text
Mac / LocalWP                                         Render
─────────────────────────────────                     ───────────────────────────────
WordPress + WooCommerce ─── ngrok HTTPS ────────────► Woo coupon Background worker
   │                  (publicly reachable)                 │
   │                                                      │ reads Woo coupons via ngrok
   └── WordPress PHP ──► Moda API on 127.0.0.1:3100         │
                               │                           │
                               └──────────┬────────────────┘
                                          ▼
                                SAME Moda PostgreSQL
                                WooCommerceInstallation
                                ShopifyDiscountCatalogue
                                ShopifyDiscount

Render recovery worker ──► BullMQ/Redis ──► Woo coupon worker
```

**Key rules:**

- **LocalWP and Moda Interact API run on your Mac. Background runs on Render.** The local API and Render Background must access the **same PostgreSQL database**.
- The Woo store is exposed to Render through **ngrok or localtunnel HTTPS**. WordPress/LocalWP must advertise that exact tunnel hostname.
- **Background does not need a per-shop URL environment variable.** It reads `WooCommerceInstallation.canonicalSiteUrl` from PostgreSQL.
- **Background owns catalogue registration and provider synchronisation**. Merchant API owns `ShopifyDiscount.isAvailable` checkbox selections. Do not manually create catalogue records.
- The API and Background services have **different connection-mode configurations**. Do not set Render to `local-development`.
- **Avoid a rotating tunnel URL:** every new hostname can mean a new Woo installation, new Shop and new REST-read authorisation. Use a reserved ngrok domain or stable localtunnel subdomain if available.
- Keep this runbook out of production merchant environments. Never commit credentials, tokens, connection exports, SQL backups or keyrings.


Prerequisites: LocalWP, ngrok or localtunnel, macOS Terminal, Python 3, `curl`, `jq`, `node`/`npm`, and WP-CLI through **LocalWP → WooCommerce Sandbox → Site Shell**. The scripts do **not** connect to or change Render, Woo REST authorisation grants or Moda PostgreSQL.

The default LocalWP WordPress root is:

```text
~/Local Sites/woocommerce-sandbox/app/public
```

If yours differs, pass the `app/public` directory as the second argument to `prepare_woo_render_test.sh`, or set `LOCAL_WP_ROOT`.

## 1. Start LocalWP and the local Moda API

1. Launch **Local** and start **WooCommerce Sandbox**.
2. Start your local API from the API repository:

```bash
cd /path/to/moda-interact-api
npm run dev
```

The API's documented `dev` command runs `tsx watch src/index.ts`. Its environment must point to the same Moda PostgreSQL database used by Render Background.

In **LocalWP's `wp-config.php`**, ensure the PHP plugin targets the local API:

For your WooCommerce Sandbox in LocalWP, the wp-config.php file should normally be located at:
~/Local Sites/woocommerce-sandbox/app/public/wp-config.php


Option 1 — Open it directly in VS Code
From your Mac terminal, run:
code "$HOME/Local Sites/woocommerce-sandbox/app/public/wp-config.php"


If you want to check that the file exists first:
ls -l "$HOME/Local Sites/woocommerce-sandbox/app/public/wp-config.php"


Option 2 — Find it through LocalWP
1. Open the Local application.
2. Select WooCommerce Sandbox.
3. Click Go to site folder.
4. Open app → public.
5. Find wp-config.php and open it in VS Code.

```php
define('MODA_INTERACT_API_BASE_URL', 'http://127.0.0.1:3100');
define('MODA_INTERACT_CONNECTION_MODE', 'local-development');
```

Do not add duplicate definitions. These settings are **not** the Woo public URL; `update_local_wp` independently manages `WP_HOME`/`WP_SITEURL`. The API's development environment uses:

```text
MODA_WOOCOMMERCE_CONNECTION_MODE=local-development
```

It may also need `MODA_WOO_REST_READ_PUBLIC_ORIGIN=http://127.0.0.1:3100` for the Woo authorisation callback/return flow; verify the API's current deployed configuration. **This is the Moda API callback origin, not the Woo store URL.** Credential-encryption keyring variable names have evolved across ARCH-039; keep the currently working API and Background key configuration consistent instead of blindly copying old variable names.

Test locally:

```bash
curl -i http://127.0.0.1:3100/health/live
```

Then check the *actual WordPress PHP-to-API route* from **LocalWP → Site Shell**:

```bash
wp eval '
$response = wp_remote_get("http://127.0.0.1:3100/health/live");
echo is_wp_error($response) ? $response->get_error_message() : wp_remote_retrieve_response_code($response);
echo PHP_EOL;
'
```

Expected result: `200`. If PHP cannot reach the API, do not reconnect yet; inspect the WordPress API origin, API process and local network restrictions.

## 2. Start a public HTTPS tunnel with LocalWP host routing

From one terminal, the launcher defaults to ngrok:

```bash
cd ~/moda-tools/ARCH-036-render-localwp
./scripts/start_woo_tunnel.sh
```

This starts ngrok with the equivalent of:

```bash
ngrok http --host-header=rewrite http://woocommerce-sandbox.local
```

LocalWP routes incoming requests using the original `.local` hostname. Without `--host-header=rewrite`, you may get **LocalWP 404: Site Not Found** even when ngrok itself is working.

Keep ngrok running throughout the test. Copy the **current `https://...ngrok-free.app` forwarding URL**. For a reserved domain, set `NGROK_DOMAIN=your-reserved.ngrok-free.app` before running the launcher.

To use localtunnel instead, select it through the same launcher:

```bash
WOO_TUNNEL_PROVIDER=localtunnel ./scripts/start_woo_tunnel.sh
```

The launcher routes to `woocommerce-sandbox.local` by default. Set `LOCALWP_ORIGIN` to override the local host/port, and optionally set `LOCALTUNNEL_SUBDOMAIN` for a stable localtunnel name. Keep it running and copy the HTTPS URL it prints (usually `https://...loca.lt`). Localtunnel has no local inspection API, so its URL must be passed to the preparation/check scripts. The scripts send localtunnel's `bypass-tunnel-reminder` header when probing the WordPress REST endpoint.

That bypass header is used only by the local preparation/check scripts. It does not make the Render Background worker send the header, so a passing local probe does **not** establish that Render can read Woo data through localtunnel. Use ngrok for the Render worker flow unless the worker's HTTP client is separately configured and reviewed to send localtunnel's required header.

To use a Cloudflare Quick Tunnel, install `cloudflared` and select it through the launcher:

```bash
WOO_TUNNEL_PROVIDER=cloudflared ./scripts/start_woo_tunnel.sh
```

The launcher runs `cloudflared tunnel --url "$LOCALWP_ORIGIN" --http-host-header <LOCALWP_HOST>` so LocalWP receives the hostname it expects (by default, `woocommerce-sandbox.local`) instead of the public tunnel hostname. Copy the generated `https://*.trycloudflare.com` URL and pass it to `prepare_woo_render_test.sh` or `check_woo_endpoints.sh`. Quick Tunnel URLs are temporary and change when restarted; use a named Cloudflare Tunnel and your own hostname if a stable URL is required. The tunnel exposes the local WordPress site publicly while running; stop it when testing is done.

**Avoid using a URL from an earlier tunnel session.** ngrok, localtunnel, and Cloudflare Quick Tunnel URLs can change when restarted.

## 3. Prepare the WordPress public identity

From another terminal:

```bash
cd ~/moda-tools/ARCH-036-render-localwp
./scripts/prepare_woo_render_test.sh 'https://CURRENT-TUNNEL.ngrok-free.app'
```

For localtunnel, either pass the URL or set it in the environment:

```bash
./scripts/prepare_woo_render_test.sh 'https://CURRENT-SUBDOMAIN.loca.lt'
LOCAL_TUNNEL_URL=' https://inspired-minimize-tap-above.trycloudflare.com' ./scripts/prepare_woo_render_test.sh
```

If ngrok's local inspection API is enabled at `127.0.0.1:4040`, you can omit the URL and let the script discover the first public HTTPS ngrok tunnel. For localtunnel or Cloudflare Quick Tunnel, pass the URL or set `LOCAL_TUNNEL_URL` because they do not provide this ngrok inspection endpoint:

```bash
./scripts/prepare_woo_render_test.sh
```

Optional custom WordPress root:

```bash
./scripts/prepare_woo_render_test.sh \
  'https://CURRENT-TUNNEL.ngrok-free.app' \
  '/my/Local Sites/woocommerce-sandbox/app/public'
```

This script:

1. Runs the included `update_local_wp` tool (idempotent), backing up `wp-config.php` before modifications.
2. Sets `WP_HOME` and `WP_SITEURL` to the public HTTPS tunnel.
3. Recognises `X-Forwarded-Proto: https` in LocalWP's trusted development configuration.
4. Verifies that `/wp-json/` returns JSON over HTTPS and advertises **both URLs** correctly.
5. Checks whether the local API responds on port 3100.

The update tool manages **only its marked block**; it refuses conflicting pre-existing WP URL definitions, and supports:

```bash
python3 scripts/update_local_wp --status
python3 scripts/update_local_wp --restore
```

The `--restore` command removes the managed block; it does **not** erase Moda connection records or reverse changes in PostgreSQL.

### Independent verification

```bash
./scripts/check_woo_endpoints.sh 'https://CURRENT-TUNNEL.ngrok-free.app'
```

The endpoint checker also accepts `https://...loca.lt`, `https://...localtunnel.me` and `https://...trycloudflare.com` origins.

Or:

```bash
curl -sS -H 'bypass-tunnel-reminder: true' 'https://CURRENT-TUNNEL.ngrok-free.app/wp-json/' \
  | jq '{home, url}'
```

Expected:

```json
{
  "home": "https://CURRENT-TUNNEL.ngrok-free.app",
  "url": "https://CURRENT-TUNNEL.ngrok-free.app"
}
```

**Do not rely solely on a `curl` request with `ngrok-skip-browser-warning: true`.** The real Background coupon transport does not send that custom header. Test without it too. A successful JSON response through the header alone may hide an ngrok interstitial problem.

## 4. Connect the WooCommerce sandbox to the LOCAL API

Open the WordPress admin through the public tunnel:

```text
https://CURRENT-TUNNEL.ngrok-free.app/wp-admin/
```

Log in with your existing **WordPress admin** account; it is not your Moda or Render password. If needed, from LocalWP Site Shell:

```bash
wp user list --fields=ID,user_login,user_email,roles
wp user update YOUR_ADMIN_LOGIN --prompt=user_pass
```

Then open **WooCommerce → Moda Interact**. The UI uses two stages: the WooCommerce submenu launches Moda Interact, then the top-level Moda Interact menu contains Overview, Recoveries, Billing, Promotions, Support and Recovery settings.

### If it says “This WordPress site address differs...”

This is **`SITE_URL_CHANGED`**. It is returned before calling the Moda API: the WordPress plugin stores an old installation URL, for example `http://woocommerce-sandbox.local`, and WordPress now advertises the public ngrok hostname. It does **not** prove the local API is unreachable.

Inspect the stored identity safely from **LocalWP Site Shell**:

```bash
/path/to/ARCH-036-render-localwp/scripts/inspect_wp_connection.sh
```

The inspector intentionally outputs only the public site URL and whether the saved URL matches—**never** the installation bearer credential.

**Disposable sandbox only** — if you need to register a new public-URL installation and the UI does not offer reconnect:

1. Take a LocalWP site/database backup first. A SQL export includes credentials, so keep it private and outside source control.
2. Confirm `wp-config.php` still points to `http://127.0.0.1:3100`, with `MODA_INTERACT_CONNECTION_MODE=local-development`.
3. After explicitly deciding to replace this sandbox's local connection identity, run in LocalWP Site Shell:

```bash
umask 077
wp db export "$HOME/woocommerce-before-ngrok-reconnect.sql"
wp option delete moda_interact_woocommerce_connection
```

4. Reload **WooCommerce → Moda Interact** through ngrok. The plugin should now show its disconnected connection flow; connect to the **local API**.
5. Complete the WordPress WooCommerce REST-read authorisation flow and confirm **read access CONNECTED**.

The API treats the new `canonicalSiteUrl` as a new installation identity; the original `.local` installation may remain in PostgreSQL. **Do not manually edit installation URLs, shop IDs or encrypted grants. Do not use these reset steps on a production merchant.**

## 5. Keep Background on Render

Render Background must continue using:

```text
MODA_WOOCOMMERCE_CONNECTION_MODE=public
```

The recovery worker needs its existing database and BullMQ/Redis configuration. It must also be able to decrypt API-sealed Woo read credentials. In the inspected Background implementation, the Woo reader expects `MODA_WOO_REST_READ_KEYRING`; the newer API implementation may derive its encryption keys from `COMMERCE_CONNECTION_KEYS_JSON` and `COMMERCE_CONNECTION_ACTIVE_KEY_ID`. **Preserve the working same-key-material arrangement appropriate to each deployed code version. Never paste key values into screenshots, shell history, tickets or this runbook.**

No environment variable for the ngrok *shop URL* should be added to Render Background: it reads `WooCommerceInstallation.canonicalSiteUrl` from the shared PostgreSQL database. API callbacks have their own `MODA_WOO_REST_READ_PUBLIC_ORIGIN` setting, which is unrelated to the Woo target.

The Render recovery worker performs:

```text
PostgreSQL global dispatcher lease WOO_COUPON_SYNC_DISPATCH (60-second cadence)
  -> register missing Woo catalogue row (SYNC_REQUIRED)
  -> reserve due Shop row (syncRequestedAt)
  -> one-off BullMQ job in woo-coupon-sync
  -> worker checks current read grant and fetches /wp-json/wc/v3/coupons
  -> CURRENT on complete success, otherwise ERROR/UNAVAILABLE
```

The queue's `removeOnComplete` and `removeOnFail` settings mean jobs can disappear from Redis Insight quickly; the absence of waiting jobs is **not** proof of missing publication.

### Render logs to filter

```text
woo.coupon_sync.dispatch_cycle
woo.coupon_sync.dispatch_failed
woo.coupon_sync.received
woo.coupon_sync.completed
woo.coupon_sync.unavailable
woo.coupon_sync.failed
```

A successful cycle has `published > 0` for a due shop, followed by `woo.coupon_sync.received` and `woo.coupon_sync.completed` with `outcome: "current"`. An idle dispatch (`reserved: 0`, `published: 0`) is normal when no shops are due. On **15 October 2026**, the new public-URL Shop emitted `woo.coupon_sync.completed` / `current`; the older `.local` Shop was still producing `unsafe_target` errors. Distinguish these by shop ID.

## 6. Verify PostgreSQL and the merchant UI

Connect to **the same** Moda PostgreSQL used by the local API and Render Background, then run:

```sql
\i /absolute/path/to/ARCH-036-render-localwp/scripts/check_woo_catalogue.sql
```

Or, using a configured `psql` connection:

```bash
psql -X -v ON_ERROR_STOP=1 -f scripts/check_woo_catalogue.sql
```

The SQL prints Shop ID, current domain, installation URL, catalogue status, last error, generation, timestamps, coupon count, ACTIVE count and merchant-selected count. It also shows the latest global dispatcher lease timestamps.

**Expected for the public-URL Shop:** `catalogueStatus = CURRENT`, `lastSuccessfulSyncAt` non-null, and coupons present if WooCommerce actually contains supported coupons. A successful empty scan may produce zero coupons.

Once CURRENT, visit **Moda Interact → Recovery settings**, click **Refresh** in Recovery Offer, select Specific discount, check multiple coupons and Save. The plugin sends a full set of internal discount IDs to the local API. `isAvailable` belongs to the merchant selection; Background manages `providerStatus` and `fixedSelectable` independently.

## 7. Troubleshooting quick reference

| Symptom | Cause / next step |
|---|---|
| Cloudflare HTTP 530 from a Quick Tunnel | Confirm the `cloudflared` process is still running and use the `trycloudflare.com` URL printed by that same current process. Inspect its terminal output for origin/DNS connection errors; the preparation script prints the Cloudflare response excerpt. |
| LocalWP **404 Site Not Found** via ngrok | Start tunnel with `--host-header=rewrite`; verify local site is running. |
| `/wp-json/` 200 but `home` or `url` still `.local` | Run `prepare_woo_render_test.sh` with **current** tunnel; inspect conflicts in `wp-config.php`. |
| `jq` reports invalid numeric literal | `curl` got non-JSON (tunnel warning, HTML, redirect or error). Check `curl -i URL/wp-json/`. |
| `curl: (56) Failure writing output...` after `| head -c` | The `head` process closed early; avoid piping a huge REST response into `head`. |
| WordPress login page | Expected; use LocalWP WordPress admin account, or reset via Site Shell WP-CLI. |
| `SITE_URL_CHANGED` / “address differs” | Plugin's stored installation is bound to the older canonical URL. Inspect state; for **disposable sandbox only**, back up then clear local connection option and reconnect. |
| Local API unreachable | Check `npm run dev`, port 3100, `MODA_INTERACT_API_BASE_URL`, and PHP-to-API `wp eval` connectivity. |
| Render `unsafe_target` | Check **the failing shop ID**. Old `.local` Shop remains unsafe; new ngrok Shop must have a public HTTPS canonical URL. Do not bypass SSRF checks. |
| Render `grant_missing`, `grant_changed` or `grant_unavailable` | Complete or renew read authorisation for the **current installation**. Verify compatible key material and credential versions. |
| Redis Insight does not show queued jobs | Look under `bull:woo-coupon-sync:*`; completed/failed jobs may be auto-removed. Use structured logs and `syncRequestedAt`. |
| `CURRENT` but merchant cannot see coupons | Confirm the **same shop ID**, local API uses same database, plugin is connected to new installation, API-002 endpoint is installed, and click Refresh. |
| Another tunnel URL after restart | Run `update_local_wp`/prepare again; canonical URL change may create another Shop and require a new read grant. Prefer a stable domain. |
| Old `.local` shop repeatedly failing | Leave historical records intact while testing; plan a separately reviewed official uninstall/deactivation, not direct SQL deletion. |

## 8. When finished

- Stop the tunnel process (`Ctrl+C`) and remove any public-exposure test credential risk.
- When you want to return to normal LocalWP `.local` access, from the kit run:

```bash
python3 scripts/update_local_wp --restore
```

- The plugin's saved tunnel-based installation will then no longer match `.local`. This is expected. Restoring the WordPress URLs **does not revert** a cloud installation or read grant; keep test identity cleanup deliberate.
- Never leave an unstable ngrok URL or local credentials configured on a real customer installation.

## Daily quick start (after the first setup)

```text
1. Start LocalWP WooCommerce Sandbox.
2. Start local API: cd /path/to/moda-interact-api && npm run dev
3. Launch ./scripts/start_woo_tunnel.sh (ngrok), WOO_TUNNEL_PROVIDER=localtunnel ./scripts/start_woo_tunnel.sh, or WOO_TUNNEL_PROVIDER=cloudflared ./scripts/start_woo_tunnel.sh; leave it running.
4. Run ./scripts/prepare_woo_render_test.sh [current HTTPS origin; use LOCAL_TUNNEL_URL for localtunnel]
5. Run ./scripts/check_woo_endpoints.sh <current HTTPS origin>
6. If hostname changed, connect/re-authorise sandbox in WordPress as needed.
7. Watch Render recovery-worker coupon log events.
8. Check scripts/check_woo_catalogue.sql and refresh Recovery settings.
```

**Files in this kit:** `scripts/start_woo_tunnel.sh`, `scripts/update_local_wp`, `scripts/prepare_woo_render_test.sh`, `scripts/check_woo_endpoints.sh`, `scripts/inspect_wp_connection.sh`, `scripts/check_woo_catalogue.sql`, and this runbook.
