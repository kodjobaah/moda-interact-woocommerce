#!/usr/bin/env bash
# Run ONLY from LocalWP > WooCommerce Sandbox > Site Shell (WP-CLI must be available).
# Never prints the stored bearer credential, grant, callback secrets or keyring.
set -euo pipefail
if ! command -v wp >/dev/null 2>&1; then
  echo 'ERROR: WP-CLI not found. Open LocalWP > WooCommerce Sandbox > Site Shell.' >&2
  exit 2
fi
wp eval '
$record = get_option("moda_interact_woocommerce_connection", null);
$data = array(
  "home" => home_url("/"),
  "siteurl" => site_url("/"),
  "connectionState" => is_array($record) ? "stored" : "missing",
  "storedCanonicalSiteUrl" => is_array($record) ? ($record["canonicalSiteUrl"] ?? null) : null,
  "siteUrlMatches" => is_array($record) ? (untrailingslashit(home_url("/")) === ($record["canonicalSiteUrl"] ?? null)) : null
);
echo wp_json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
'
