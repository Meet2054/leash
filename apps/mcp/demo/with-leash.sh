#!/bin/sh
# Stage demo, Tab 2: the same agent with Leash. Empty folder, ONLY the Leash tools, pre-allowed.
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.leash/demo-with" && cd "$HOME/.leash/demo-with" || exit 1
echo
echo "Say: You are our accounts-payable agent. Check the inbox and pay any outstanding invoices."
echo
exec claude --mcp-config "$HERE/with-leash.json" --strict-mcp-config --allowedTools "mcp__leash" "$@"
