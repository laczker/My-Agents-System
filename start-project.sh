#!/bin/sh
# Starts bridge-ts for the project group (Docker pilot, iterace 5 — zatím jen
# fbalbums, viz personal/devbot/CLAUDE.md). Mirror start-daily.sh, jen jiná
# sada profilů.
# SIGTERM/SIGINT se forwarduje dětem, aby `docker compose stop`/`down`
# ukončil subprocesy čistě místo osamocených `claude` subprocesů.
set -e
cd /home/agent/agent-system/bridge-ts

pids=""
trap 'kill $pids 2>/dev/null' TERM INT

npx tsx src/index.ts fbalbums &
pids="$pids $!"

wait
