#!/bin/sh
# Double-click to play Pip's Notebook on macOS (on Linux: sh start.command). Needs Node.js 22+ from https://nodejs.org.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS from https://nodejs.org, then double-click start.command again."
  command -v open >/dev/null 2>&1 && open "https://nodejs.org/en/download"
  printf "Press Return to close this window. "; read -r _
  exit 1
fi
node scripts/start.mjs "$@"
status=$?
if [ "$status" -ne 0 ]; then printf "\nPress Return to close this window. "; read -r _; fi
exit "$status"
