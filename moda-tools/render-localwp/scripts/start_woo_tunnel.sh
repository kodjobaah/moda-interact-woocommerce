#!/usr/bin/env bash
# LocalWP -> public HTTPS tunnel, with host routing expected by Local's router.
set -euo pipefail

TUNNEL_PROVIDER="${TUNNEL_PROVIDER:-${WOO_TUNNEL_PROVIDER:-ngrok}}"
LOCALWP_ORIGIN="${LOCALWP_ORIGIN:-http://woocommerce-sandbox.local}"
if [[ ! "$LOCALWP_ORIGIN" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  echo 'ERROR: LOCALWP_ORIGIN must be the origin only (e.g. http://woocommerce-sandbox.local).' >&2
  exit 2
fi

case "$TUNNEL_PROVIDER" in
  ngrok)
    if ! command -v ngrok >/dev/null 2>&1; then
      echo 'ERROR: ngrok not found. Install/configure ngrok first.' >&2
      exit 2
    fi
    echo "Starting ngrok -> $LOCALWP_ORIGIN (Host-header rewrite enabled)."
    echo 'Keep this terminal running. In another terminal run prepare_woo_render_test.sh.'
    if [[ -n "${NGROK_DOMAIN:-}" ]]; then
      echo "Using reserved ngrok domain: $NGROK_DOMAIN"
      exec ngrok http --host-header=rewrite --domain="$NGROK_DOMAIN" "$LOCALWP_ORIGIN"
    fi
    exec ngrok http --host-header=rewrite "$LOCALWP_ORIGIN"
    ;;
  localtunnel)
    localwp_authority="${LOCALWP_ORIGIN#*://}"
    if [[ "$LOCALWP_ORIGIN" == https://* ]]; then
      localwp_port=443
    else
      localwp_port=80
    fi
    if [[ "$localwp_authority" == *:* ]]; then
      localwp_port="${localwp_authority##*:}"
      localwp_host="${localwp_authority%:*}"
    else
      localwp_host="$localwp_authority"
    fi
    localtunnel_args=(--port "$localwp_port" --local-host "$localwp_host")
    if [[ "$LOCALWP_ORIGIN" == https://* ]]; then
      localtunnel_args+=(--local-https)
    fi
    if [[ -n "${LOCALTUNNEL_SUBDOMAIN:-}" ]]; then
      localtunnel_args+=(--subdomain "$LOCALTUNNEL_SUBDOMAIN")
    fi
    echo "Starting localtunnel -> $LOCALWP_ORIGIN (local host: $localwp_host, port: $localwp_port)."
    echo 'Keep this terminal running. Copy its HTTPS URL, then run prepare_woo_render_test.sh.'
    if command -v lt >/dev/null 2>&1; then
      exec lt "${localtunnel_args[@]}"
    fi
    if ! command -v npx >/dev/null 2>&1; then
      echo 'ERROR: Neither lt nor npx was found. Install Node.js/npm or localtunnel.' >&2
      exit 2
    fi
    exec npx --yes localtunnel "${localtunnel_args[@]}"
    ;;
  cloudflared)
    if ! command -v cloudflared >/dev/null 2>&1; then
      echo 'ERROR: cloudflared not found. Install Cloudflare Tunnel first.' >&2
      exit 2
    fi
    localwp_authority="${LOCALWP_ORIGIN#*://}"
    localwp_host="${localwp_authority%%:*}"
    echo "Starting Cloudflare Quick Tunnel -> $LOCALWP_ORIGIN (origin Host: $localwp_host)."
    echo 'Copy the generated https://*.trycloudflare.com URL, then pass it to prepare_woo_render_test.sh.'
    echo 'Keep this terminal running. Quick Tunnel URLs are temporary and change when restarted.'
    exec cloudflared tunnel --url "$LOCALWP_ORIGIN" --http-host-header "$localwp_host"
    ;;
  *)
    echo "ERROR: Unsupported TUNNEL_PROVIDER '$TUNNEL_PROVIDER'. Use 'ngrok', 'localtunnel' or 'cloudflared'." >&2
    exit 2
    ;;
esac
