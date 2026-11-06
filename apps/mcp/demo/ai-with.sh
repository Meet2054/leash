#!/bin/sh
# Stage demo: the SAME open-weight model runs with Leash. Usage: ai-with.sh [model]
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${LEASH_NODE:-$(command -v node || echo /Users/adi-21/.local/bin/node)}"
pgrep -x ollama >/dev/null || (nohup ollama serve >/tmp/ollama.log 2>&1 &) ; sleep 1
cd "$HERE" && LEASH_VAULT="${LEASH_VAULT:-0x94a88f031C2756b32212F8e68aB7ec3C29f67c8c}" exec "$NODE" "$HERE/node_modules/tsx/dist/cli.mjs" scripts/agent-run.ts leash "${1:-qwen3.5:4b}"
