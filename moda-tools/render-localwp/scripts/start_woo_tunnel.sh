#!/usr/bin/env bash
# LocalWP -> public HTTPS ngrok tunnel, with the Host header expected by Local's router.
set -euo pipefail

LOCALWP_ORIGIN="${LOCALWP_ORIGIN:-http://woocommerce-sandbox.local}"
if ! command -v ngrok >/dev/null 2>&1; then
  echo 'ERROR: ngrok not found. Install/configure ngrok first.' >&2
  exit 2
fi
if [[ ! "$LOCALWP_ORIGIN" =~ ^https?://[^/]+$ ]]; then
  echo 'ERROR: LOCALWP_ORIGIN must be the origin only (e.g. http://woocommerce-sandbox.local).' >&2
  exit 2
fi

echo "Starting ngrok -> $LOCALWP_ORIGIN (Host-header rewrite enabled)."
echo 'Keep this terminal running. In another terminal run prepare_woo_render_test.sh.'
if [[ -n "${NGROK_DOMAIN:-}" ]]; then
  echo "Using reserved ngrok domain: $NGROK_DOMAIN"
  exec ngrok http --host-header=rewrite --domain="$NGROK_DOMAIN" "$LOCALWP_ORIGIN"
fi
exec ngrok http --host-header=rewrite "$LOCALWP_ORIGIN"
