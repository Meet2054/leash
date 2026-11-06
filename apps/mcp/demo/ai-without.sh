#!/bin/sh
# Stage demo: an open-weight AI model (default Qwen 3.5 4B, local via Ollama) runs the ordinary agent wallet.
# Resets the wallet and puts the fake invoice back first. Usage: ai-without.sh [model]
HERE="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${LEASH_NODE:-$(command -v node || echo /Users/adi-21/.local/bin/node)}"
pgrep -x ollama >/dev/null || (nohup ollama serve >/tmp/ollama.log 2>&1 &) ; sleep 1
"$HERE/bin/plain-wallet" --reset 0x614f30b1475D24613dF09e98A3FFE1bFF2558F5C
cd "$HERE" && exec "$NODE" "$HERE/node_modules/tsx/dist/cli.mjs" scripts/agent-run.ts plain "${1:-qwen3.5:4b}"
