#!/usr/bin/env bash
# Deploy Leash to Whitechain testnet (1874) and verify on Blockscout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a
export DEPLOYER_PK="$RELAYER_PK_WHITECHAIN" TOKEN_ADDRESS="$USDT_ADDRESS" HTS_ASSOCIATE=false
cd "$ROOT/contracts"
forge script script/Deploy.s.sol --rpc-url "$WHITECHAIN_RPC" --broadcast --slow \
  --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ "$@"
cat deployments/1874.json
