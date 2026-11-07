#!/usr/bin/env bash
# Runs the whole live stack on this machine and keeps it up:
#   - keeps the Mac awake while it runs (caffeinate: no idle/system sleep; the screen may still turn off)
#   - starts the facilitator, merchant, web app, Ollama (if not already up) and the Cloudflare tunnel
#   - restarts any of them that exits, and restarts the tunnel when the public site stops answering
#
#   scripts/serve.sh start     # detached: survives closing the terminal / the Claude session
#   scripts/serve.sh stop
#   scripts/serve.sh status
# Logs: data/logs/<service>.log, data/logs/supervisor.log. Closing the lid still sleeps the Mac (see README).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/data/logs"
TUNNEL_CONFIG="${TUNNEL_CONFIG:-$HOME/.cloudflared/leash.yml}"
SITE="${SITE:-https://permissionless.in/api/config}"
mkdir -p "$LOGS"
cd "$ROOT"

log() { echo "$(date '+%F %T') $*" >> "$LOGS/supervisor.log"; }

stop_all() {
  pkill -f "scripts/serve.sh run" 2>/dev/null
  pkill -f "caffeinate -ims -w" 2>/dev/null
  pkill -f "next start -p" 2>/dev/null
  pkill -f "packages/facilitator.*src/server.ts|@leash/facilitator" 2>/dev/null
  pkill -f "apps/merchant.*src/server.ts|@leash/merchant" 2>/dev/null
  pkill -f "cloudflared tunnel --no-autoupdate --config $TUNNEL_CONFIG" 2>/dev/null
  for p in 3000 4021 4022; do lsof -ti "tcp:$p" -sTCP:LISTEN | xargs -r kill 2>/dev/null; done
}

# run <name> <command...>: restart forever, 3 s between tries
supervise() {
  local name="$1"
  shift
  (
    while true; do
      log "start $name"
      "$@" >> "$LOGS/$name.log" 2>&1
      log "$name exited ($?); restarting in 3 s"
      sleep 3
    done
  ) &
}

run() {
  log "supervisor up (pid $$)"
  caffeinate -ims -w $$ &
  if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:11434/api/tags; then supervise ollama ollama serve; fi
  supervise facilitator env FACILITATOR_PUBLIC_URL=https://facilitator.permissionless.in DEMO_FAUCET=1 BIND_HOST=127.0.0.1 pnpm facilitator
  sleep 6
  supervise merchant env MERCHANT_PUBLIC_URL=https://merchant.permissionless.in BIND_HOST=127.0.0.1 pnpm merchant
  supervise web env APP_URL=https://permissionless.in WORLD_FLOW=browser WORLD_REDIRECT_URI=https://permissionless.in/api/world/callback BIND_HOST=127.0.0.1 pnpm --filter @leash/web start
  supervise tunnel cloudflared tunnel --no-autoupdate --config "$TUNNEL_CONFIG" run leash
  # tunnel health: if the public site fails twice in a row (~1 min), kill cloudflared; the supervisor restarts it
  local fails=0
  sleep 45
  while true; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$SITE")
    if [ "$code" = "530" ] || [ "$code" = "502" ] || [ "$code" = "000" ]; then fails=$((fails + 1)); else fails=0; fi
    if [ "$fails" -ge 2 ]; then
      log "site answered $code twice; restarting the tunnel"
      pkill -f "cloudflared tunnel --no-autoupdate --config $TUNNEL_CONFIG"
      fails=0
      sleep 20
    fi
    sleep 30
  done
}

case "${1:-start}" in
  start)
    stop_all
    sleep 2
    (nohup "$0" run > "$LOGS/serve.out" 2>&1 &)
    echo "Leash is starting in the background (logs: data/logs). Check with: scripts/serve.sh status"
    ;;
  run) run ;;
  stop)
    stop_all
    echo "stopped"
    ;;
  status)
    for u in http://127.0.0.1:4021/supported http://127.0.0.1:4022/health http://127.0.0.1:3000/api/config "$SITE"; do
      printf '%-48s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u")"
    done
    pgrep -fl "caffeinate -ims" > /dev/null && echo "awake: yes (caffeinate running)" || echo "awake: NO"
    tail -n 5 "$LOGS/supervisor.log" 2>/dev/null
    ;;
  *) echo "usage: scripts/serve.sh start|stop|status" ;;
esac
