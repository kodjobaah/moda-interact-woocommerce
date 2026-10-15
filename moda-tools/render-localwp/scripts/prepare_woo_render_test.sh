#!/usr/bin/env bash
# Safe, repeatable LocalWP/ngrok preparation. Does NOT touch Moda installations or credentials.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ORIGIN="${1:-}"
WP_ROOT="${2:-${LOCAL_WP_ROOT:-$HOME/Local Sites/woocommerce-sandbox/app/public}}"
LOCAL_API_ORIGIN="${MODA_LOCAL_API_ORIGIN:-http://127.0.0.1:3100}"

for program in curl jq python3; do
  if ! command -v "$program" >/dev/null 2>&1; then
    echo "ERROR: Missing required command '$program'." >&2
    exit 2
  fi
done

if [[ -z "$ORIGIN" ]]; then
  echo 'Discovering the public HTTPS tunnel from the local ngrok inspection API...'
  ORIGIN="$(curl --connect-timeout 2 --max-time 5 -fsS 'http://127.0.0.1:4040/api/tunnels' | jq -r '[.tunnels[]?.public_url | select(type == "string" and startswith("https://"))][0] // empty')" || {
    echo 'ERROR: Cannot query ngrok. Supply its HTTPS URL explicitly.' >&2
    exit 2
  }
fi

if [[ -z "$ORIGIN" ]]; then
  echo 'ERROR: No HTTPS tunnel found. Start ngrok or pass the public HTTPS origin.' >&2
  exit 2
fi

# The URL updater validates the origin and creates a timestamped wp-config.php backup.
echo 'Updating the LocalWP WordPress canonical URL...'
python3 "$SCRIPT_DIR/update_local_wp" "$ORIGIN" --root "$WP_ROOT"

# Read-only verification, without following any redirects or suppressing HTTP errors.
BODY="$(mktemp)"
HEADERS="$(mktemp)"
trap 'rm -f "$BODY" "$HEADERS"' EXIT

VERIFY_URL="${ORIGIN%/}/wp-json/"
echo "Checking public WordPress REST endpoint: $VERIFY_URL"
HTTP_CODE="$(curl --connect-timeout 5 --max-time 20 -sS -D "$HEADERS" -o "$BODY" -w '%{http_code}' "$VERIFY_URL")" || {
  echo 'ERROR: ngrok cannot fetch WordPress; check LocalWP, tunnel and host-header rewrite.' >&2
  exit 1
}
if [[ "$HTTP_CODE" != '200' ]]; then
  echo "ERROR: WordPress REST returned HTTP $HTTP_CODE (expected 200)." >&2
  grep -iE '^(HTTP/|location:|content-type:)' "$HEADERS" || true
  exit 1
fi
if ! jq -e --arg url "${ORIGIN%/}" '(.home == $url) and (.url == $url)' "$BODY" >/dev/null 2>&1; then
  echo 'ERROR: The WordPress REST response does not advertise the configured tunnel URL.' >&2
  if jq empty "$BODY" 2>/dev/null; then jq '{home,url}' "$BODY"; else head -c 150 "$BODY"; echo; fi
  exit 1
fi
jq '{home,url}' "$BODY"
echo 'PASS: WordPress publicly advertises the HTTPS ngrok URL.'

if ! curl --connect-timeout 2 --max-time 5 -fsS "$LOCAL_API_ORIGIN/health/live" >/dev/null; then
  echo "WARNING: The local Moda API did not answer at $LOCAL_API_ORIGIN/health/live." >&2
  echo 'Start the local API, then check access from the LocalWP Site Shell.' >&2
else
  echo "PASS: Local Moda API is responding at $LOCAL_API_ORIGIN/health/live."
fi

echo
cat <<'STEPS'
NEXT (manual; this tool deliberately never changes connection/credential records):
1. From LocalWP Site Shell, check PHP -> local API connectivity (see runbook).
2. In disposable WP sandbox, back up before clearing any old .local connection.
3. In WordPress admin through ngrok, connect/reconnect Moda and authorise REST read.
4. On Render, watch woo.coupon_sync.dispatch_cycle / received / completed.
5. Check PostgreSQL with scripts/check_woo_catalogue.sql.
STEPS
