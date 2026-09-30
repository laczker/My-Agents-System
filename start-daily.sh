#!/bin/sh
# Starts bridge-ts for all 5 daily bots in a single container (Docker pilot,
# iteration 1 — 2 containers instead of 1-per-bot, see personal/devbot/CLAUDE.md).
# "assistant" is the profile with no argument (backward compatibility, see
# config.ts).
# SIGTERM/SIGINT is forwarded to all children, so `docker compose stop`/`down`
# terminates the subprocesses cleanly instead of leaving orphaned `claude`
# subprocesses.
set -e
cd /home/agent/agent-system/bridge-ts

pids=""
trap 'kill $pids 2>/dev/null' TERM INT

npx tsx src/index.ts &
pids="$pids $!"
for profile in zpravodaj mailista joby nakup; do
  npx tsx src/index.ts "$profile" &
  pids="$pids $!"
done

wait
