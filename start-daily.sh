#!/bin/sh
# Spustí bridge-ts pro všech 5 denních botů v jednom kontejneru (Docker pilot,
# iterace 1 — 2 kontejnery místo 1-na-bota, viz personal/devbot/CLAUDE.md).
# "assistant" je profil bez argumentu (zpětná kompatibilita, viz config.ts).
# SIGTERM/SIGINT se přepošle všem dětem, ať `docker compose stop`/`down` ukončí
# i podprocesy čistě místo osiřelých `claude` subprocessů.
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
