#!/usr/bin/env bash
# Build ZKNox's NIST Falcon C code in its ETHFALCON (keccak hash-to-point) mode to a single-file ES module
# for in-browser owner signing. Output: apps/web/lib/client/ethfalcon-wasm.mjs (committed, so the web app
# builds without emsdk). Requires emcc (brew install emscripten).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/contracts/lib/ETHFALCON/falcon/nistfalcon/src"
OUT="$ROOT/apps/web/lib/client/ethfalcon-wasm.mjs"
cd "$SRC"
emcc -O3 -DETHFALCON=1 -I. \
  codec.c common.c fft.c fpr.c keygen.c nist16.c rng.c shake.c sign.c vrfy.c keccak_prng.c keccak256.c \
  "$ROOT/tools/falcon-wasm/leash_rng.c" \
  -s WASM=1 -s SINGLE_FILE=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createEthFalcon \
  -s ENVIRONMENT=web,worker,node \
  -s EXPORTED_FUNCTIONS='["_zknox_crypto_sign_keypair_from_seed","_zknox_crypto_sign","_zknox_crypto_sign_open","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","HEAPU32"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -o "$OUT"
echo "built $OUT ($(wc -c < "$OUT") bytes)"
