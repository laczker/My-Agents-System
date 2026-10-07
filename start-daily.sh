#!/bin/sh
# Starts bridge-ts for the daily-bot group in a single container (Docker
# pilot, iteration 1 — 2 containers instead of 1-per-bot, see
# personal/devbot/CLAUDE.md). "assistant" is the profile with no argument
# (backward compatibility, see config.ts).
# Which profiles start is controlled by $DAILY_PROFILES (space-separated),
# defaulting to the contents of /daily-profiles.txt (the repo's daily-profiles.txt,
# mounted read-only by docker-compose.daily.yml — single source of truth shared with
# watchdog.sh and the dashboard).
# SIGTERM/SIGINT is forwarded to all children, so `docker compose stop`/`down`
# terminates the subprocesses cleanly instead of leaving orphaned `claude`
# subprocesses.
set -e
cd /home/agent/agent-system/bridge-ts

if [ -z "${DAILY_PROFILES:-}" ]; then
  DAILY_PROFILES=$(cat /daily-profiles.txt 2>/dev/null || true)
fi
if [ -z "$DAILY_PROFILES" ]; then
  echo "start-daily.sh: no profiles (DAILY_PROFILES unset and /daily-profiles.txt missing/empty)" >&2
  exit 1
fi

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
