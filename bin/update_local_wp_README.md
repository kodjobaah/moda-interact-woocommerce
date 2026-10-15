# `update_local_wp` — ARCH-036 LocalWP/ngrok testing

This script configures the **local WooCommerce sandbox** to advertise a public HTTPS ngrok URL. It changes **only a clearly marked block in `wp-config.php`**, creates a timestamped backup before modifying the file, and never edits your WordPress database or Moda Interact credentials.



Invoke as `~/bin/update_local_wp` or add `~/bin` to your `PATH` to invoke as `update_local_wp`.

## Usage

```bash
bin/update_local_wp https://YOUR-TUNNEL.ngrok-free.app
bin/update_local_wp --status
bin/update_local_wp --restore
```

The default target is:

`~/Local Sites/woocommerce-sandbox/app/public/wp-config.php`

For a nonstandard LocalWP path, use `--root '/path/to/app/public'`. The script refuses ambiguous config files and duplicate/conflicting existing `WP_HOME` / `WP_SITEURL` constants.

Run ngrok separately with the LocalWP Host rewrite; for example:

```bash
ngrok http --host-header=rewrite http://woocommerce-sandbox.local
```

Verify the new WordPress canonical URL:

```bash
curl -sS -H 'ngrok-skip-browser-warning: true' \
  'https://YOUR-TUNNEL.ngrok-free.app/wp-json/' | jq '{home, url}'
```

Do **not** change database installation identities manually. Changing the WordPress canonical URL can require a new/reconnected Moda WooCommerce installation and fresh REST-read authorization, and an ngrok hostname change may create a different installation identity. Use a stable/reserved tunnel domain where possible. Public HTTPS ngrok exposure is for temporary development only; avoid exposing the site longer than necessary.

`--restore` removes the script-owned overrides and leaves the WordPress database's original `.local` URLs in place. It does not reconnect or revoke remote credentials automatically.
