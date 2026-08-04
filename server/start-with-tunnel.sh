#!/usr/bin/env bash
# Starts the CRM server, then a Cloudflare quick tunnel pointed at it.
# Ctrl+C stops both. See ../TUNNEL.md for setup (installing cloudflared).
set -e
cd "$(dirname "$0")"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found on PATH. See TUNNEL.md for install steps."
  exit 1
fi

echo "Starting Pipeline CRM server..."
node server.js &
SERVER_PID=$!

cleanup() {
  echo ""
  echo "Stopping tunnel and server..."
  kill $SERVER_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

sleep 1
echo ""
echo "Starting Cloudflare tunnel — look for the https://...trycloudflare.com link below:"
echo ""
cloudflared tunnel --url http://localhost:3000

cleanup
