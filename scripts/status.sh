#!/usr/bin/env bash
# Collects the automatic parts of LEASH_STATUS.md (spec §12). The narrative parts are written by hand/agent.
# Usage: pnpm status   (writes data/status-auto.md and prints it)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="$ROOT/data/status-auto.md"
mkdir -p data
FAC="${FACILITATOR_URL:-http://localhost:4021}"
RPC="${WHITECHAIN_RPC:-https://rpc.testnet.whitechain.io}"
{
  echo "# auto-collected $(TZ=Asia/Kolkata date '+%Y-%m-%dT%H:%M:%S%z') IST"
  echo
  echo "## forge"
  (cd contracts && forge test 2>&1 | grep -E "Suite result|Ran [0-9]+ test suites|\[FAIL" ) || echo "forge: could not run"
  echo
  echo "## vitest"
  for p in packages/sdk packages/relayer packages/facilitator apps/web; do
    r=$(cd "$p" && npx vitest run 2>&1 | grep -E "^\s+Tests|FAIL" | sed 's/\x1b\[[0-9;]*m//g' | head -5)
    echo "- $p: ${r:-could not run}"
  done
  echo
  echo "## deployments (1874)"
  cat contracts/deployments/1874.json 2>/dev/null || echo "none"
  echo
  echo "## relayer"
  RELAYER=$(python3 -c "import json;print(json.load(open('contracts/deployments/1874.json'))['relayer'])" 2>/dev/null)
  [ -n "$RELAYER" ] && echo "- WBT balance: $(cast balance "$RELAYER" --rpc-url "$RPC" --ether 2>/dev/null || echo '?')"
  echo "- gas tank: $(curl -s -m 5 "$FAC/gas-tank" || echo 'facilitator not running')"
  echo
  echo "## live metrics"
  echo "$(curl -s -m 5 "$FAC/stats" || echo 'facilitator not running')"
  echo
  echo "## recent claims"
  curl -s -m 5 "$FAC/claims?limit=5" || echo "facilitator not running"
  echo
  echo "## git"
  git log --oneline | head -40
} > "$OUT" 2>&1
cat "$OUT"
