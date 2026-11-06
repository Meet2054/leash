#!/usr/bin/env bash
# Keeps the Cloudflare tunnel up for the live demo: if the public site returns 530 (Cloudflare can't reach
# the tunnel) or nothing twice in a row (~60 s), restart cloudflared. Local services are not touched.
# Usage: scripts/tunnel-watchdog.sh [config=~/.cloudflared/leash.yml] [url=https://permissionless.in/api/config]
CONFIG="${1:-$HOME/.cloudflared/leash.yml}"
URL="${2:-https://permissionless.in/api/config}"
LOG="${TUNNEL_LOG:-/tmp/leash-tunnel.log}"
fails=0
while true; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL")
  if [ "$code" = "530" ] || [ "$code" = "502" ] || [ "$code" = "000" ]; then fails=$((fails + 1)); else fails=0; fi
  if [ "$fails" -ge 2 ]; then
    echo "$(date '+%F %T') site returned $code twice; restarting tunnel" >> "$LOG.watchdog"
    pkill -f "cloudflared tunnel --no-autoupdate --config $CONFIG" ; sleep 2
    nohup cloudflared tunnel --no-autoupdate --config "$CONFIG" run leash >> "$LOG" 2>&1 &
    fails=0
    sleep 20
  fi
  sleep 30
done
