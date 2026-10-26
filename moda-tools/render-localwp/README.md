# ARCH-036 — Render Background + LocalWP testing kit

Read **[the complete runbook](docs/ARCH-036-Render-LocalWP-WooCommerce-Testing-Runbook.md)**. It covers LocalWP/ngrok, localtunnel or Cloudflare Tunnel/Moda API setup, installation re-authorisation, Render worker checks, PostgreSQL diagnostics, and safe cleanup.

Quick commands:

```bash
./scripts/start_woo_tunnel.sh              # separate terminal, keep it running
TUNNEL_PROVIDER=localtunnel ./scripts/start_woo_tunnel.sh # select localtunnel
TUNNEL_PROVIDER=cloudflared ./scripts/start_woo_tunnel.sh # select Cloudflare Quick Tunnel
./scripts/prepare_woo_render_test.sh      # auto-discover ngrok, or set LOCAL_TUNNEL_URL
./scripts/check_woo_endpoints.sh https://CURRENT-TUNNEL.ngrok-free.app
# Optional (from LocalWP Site Shell):
./scripts/inspect_wp_connection.sh
```

**Caution:** Do not put Moda credentials, WordPress database exports, API bearer tokens, or credential keyrings into the repository or logs.
