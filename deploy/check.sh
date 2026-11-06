#!/usr/bin/env bash
# Smoke-check a Leash deploy:  bash deploy/check.sh leash.example.com   (or  http://localhost:8088  for a local proxy test)
set -uo pipefail
BASE="${1:?usage: check.sh DOMAIN|URL}"
case "$BASE" in http*) ;; *) BASE="https://$BASE";; esac
ok=0; fail=0
check() { # name url expected_status
  local code; code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$2")
  if [ "$code" = "$3" ]; then echo "  ✓ $1 ($code)"; ok=$((ok+1)); else echo "  ✘ $1 → $code (want $3)  $2"; fail=$((fail+1)); fi
}
echo "checking $BASE"
check "owner app"                 "$BASE/"                                200
check "attestor config"           "$BASE/api/config"                      200
check "facilitator health"        "$BASE/facilitator/health"              200
check "facilitator /supported"    "$BASE/facilitator/supported"           200
check "discovery"                 "$BASE/facilitator/discovery/resources" 200
check "merchant health"           "$BASE/merchant/health"                 200
check "merchant discovery doc"    "$BASE/merchant/.well-known/x402"       200
check "paid endpoint → 402"       "$BASE/merchant/quote"                  402
curl -s -m 15 "$BASE/facilitator/supported" | grep -q '"leash-batch"' && echo "  ✓ leash-batch advertised" || { echo "  ✘ leash-batch missing"; fail=$((fail+1)); }
echo "$ok ok, $fail failed"
[ "$fail" = 0 ]
