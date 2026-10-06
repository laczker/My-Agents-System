#!/bin/sh
# Starts bridge-ts for the daily-bot group in a single container (Docker
# pilot, iteration 1 — 2 containers instead of 1-per-bot, see
# personal/devbot/CLAUDE.md). "assistant" is the profile with no argument
# (backward compatibility, see config.ts).
# Which profiles start is controlled by $DAILY_PROFILES (space-separated),
# defaulting to all 6 — iteration 6 (nakup canary cutover) overrides it in
# docker-compose.daily.yml to start only "nakup", so the container doesn't
# also take over assistant/zpravodaj/mailista/joby while their host processes
# are still the live ones.
# SIGTERM/SIGINT is forwarded to all children, so `docker compose stop`/`down`
# terminates the subprocesses cleanly instead of leaving orphaned `claude`
# subprocesses.
set -e
cd /home/agent/agent-system/bridge-ts

: "${DAILY_PROFILES:=assistant zpravodaj mailista joby nakup trener}"

pids=""
trap 'kill $pids 2>/dev/null' TERM INT

for profile in $DAILY_PROFILES; do
  if [ "$profile" = "assistant" ]; then
    npx tsx src/index.ts &
  else
    npx tsx src/index.ts "$profile" &
  fi
  pids="$pids $!"
done

wait
