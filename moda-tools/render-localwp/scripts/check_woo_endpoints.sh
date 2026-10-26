#!/usr/bin/env bash
# Read-only diagnostics. No WordPress authentication secrets or query-string credentials.
set -euo pipefail

ORIGIN="${1:-}"
LOCAL_API_ORIGIN="${MODA_LOCAL_API_ORIGIN:-http://127.0.0.1:3100}"
if [[ -z "$ORIGIN" ]]; then
  echo 'Usage: check_woo_endpoints.sh <public-tunnel-https-origin>' >&2
  exit 2
fi
for program in curl jq; do
  command -v "$program" >/dev/null || { echo "Missing '$program'" >&2; exit 2; }
done

# Strict origin-only tunnel URL to avoid unexpected requests to arbitrary hosts.
if [[ ! "$ORIGIN" =~ ^https://[a-zA-Z0-9-]+\.(ngrok-free\.app|ngrok\.app|ngrok\.io|loca\.lt|localtunnel\.me|trycloudflare\.com)/?$ ]]; then
  echo 'ERROR: Expected a supported public HTTPS tunnel origin with no extra path.' >&2
  exit 2
fi
ORIGIN="${ORIGIN%/}"

headers="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$headers" "$body"' EXIT

echo "WordPress REST: $ORIGIN/wp-json/"
status="$(curl --connect-timeout 5 --max-time 20 -sS -H 'bypass-tunnel-reminder: true' -D "$headers" -o "$body" -w '%{http_code}' "$ORIGIN/wp-json/")" || {
  echo 'FAIL: Tunnel/network error.' >&2
  exit 1
}
echo "HTTP $status"
if [[ "$status" != '200' ]]; then
  grep -iE '^(HTTP/|location:|content-type:)' "$headers" || true
  exit 1
fi
if ! jq -e . "$body" >/dev/null 2>&1; then
  echo 'FAIL: Response is not JSON (tunnel warning, LocalWP page or other HTML).' >&2
  head -c 150 "$body"; echo
  exit 1
fi
jq '{home,url,modaRegistered:([.namespaces[]? | select(. == "moda-interact/v1")] | length > 0),wooV3Registered:([.namespaces[]? | select(. == "wc/v3")] | length > 0)}' "$body"
if ! jq -e --arg url "$ORIGIN" '.home == $url and .url == $url' "$body" >/dev/null; then
  echo 'FAIL: WP_HOME and WP_SITEURL are not both the current tunnel origin.' >&2
  exit 1
fi
if ! jq -e '(.namespaces | index("wc/v3")) != null and (.namespaces | index("moda-interact/v1")) != null' "$body" >/dev/null; then
  echo 'FAIL: Missing required WooCommerce/Moda REST namespace.' >&2
  exit 1
fi

echo 'PASS: Public WordPress site identity and namespaces.'
if curl --connect-timeout 2 --max-time 5 -fsS "$LOCAL_API_ORIGIN/health/live" >/dev/null; then
  echo 'PASS: Local Moda API /health/live.'
else
  echo 'WARNING: Local Moda API /health/live is unreachable from this shell.' >&2
fi
