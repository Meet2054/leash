#!/bin/sh
# Stage demo: the agent's key file is stolen. Without Leash the key IS the money; with Leash it holds nothing.
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${LEASH_NODE:-$(command -v node || echo /Users/adi-21/.local/bin/node)}"
cd "$HERE" && exec "$NODE" "$HERE/node_modules/tsx/dist/cli.mjs" scripts/steal-key.ts 0x614f30b1475D24613dF09e98A3FFE1bFF2558F5C 0x94a88f031C2756b32212F8e68aB7ec3C29f67c8c
