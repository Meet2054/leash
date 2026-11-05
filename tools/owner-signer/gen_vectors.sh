#!/usr/bin/env bash
# Regenerate contracts/test/vectors/falcon_leash.json:
#   1) a throwaway ETHFALCON test key (keys/falcon-vector-owner.json, gitignored),
#   2) forge computes Leash EIP-712 digests at fixed test addresses,
#   3) the Python reference signer signs them off-chain,
#   4) FalconE2E.t.sol verifies them on-chain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="$ROOT/tools/owner-signer/.venv/bin/python"
SIGNER="$ROOT/tools/owner-signer/falcon_signer.py"
KEY="$ROOT/keys/falcon-vector-owner.json"
VEC="$ROOT/contracts/test/vectors"

[ -f "$KEY" ] || "$PY" "$SIGNER" keygen --out "$KEY" >/dev/null
PUB=$("$PY" "$SIGNER" pubkey --key "$KEY" | "$PY" -c 'import json,sys;print(json.load(sys.stdin)["pubKey"])')

(cd "$ROOT/contracts" && GEN_FALCON_PUBKEY="$PUB" forge test --mt test_genDigests -q >/dev/null)

"$PY" - "$VEC/falcon_leash_digests.json" "$VEC/falcon_leash.json" "$KEY" "$SIGNER" <<'EOF'
import json, sys, importlib.util
digests_path, out_path, key_path, signer_path = sys.argv[1:5]
spec = importlib.util.spec_from_file_location("falcon_signer", signer_path)
fs = importlib.util.module_from_spec(spec); spec.loader.exec_module(fs)
d = json.load(open(digests_path))
sk = fs.load_key(key_path)
def sig(h): return "0x" + fs.sign(sk, bytes.fromhex(h[2:])).hex()
out = {
  "note": "ETHFALCON-512 signatures made off-chain by tools/owner-signer over Leash EIP-712 digests (chainId 31337, FalconE2E fixed addresses). Throwaway test key.",
  "pubKey": d["pubKey"], "vault": d["vault"],
  "initDigest": d["initDigest"], "initSig": sig(d["initDigest"]),
  "change0Digest": d["change0Digest"], "change0Sig": sig(d["change0Digest"]),
  "change1Digest": d["change1Digest"], "change1Sig": sig(d["change1Digest"]),
}
json.dump(out, open(out_path, "w"), indent=2)
print("wrote", out_path)
EOF
rm -f "$VEC/falcon_leash_digests.json"
