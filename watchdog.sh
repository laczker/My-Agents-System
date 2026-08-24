#!/bin/bash
# Restartuje bridge-ts procesy, pokud neběží. Náhrada za systemd Restart=always —
# na hostu není dostupný root ani docker socket (viz DECISIONS.md), takže
# supervize jede přes cron (crontab -e, spouští se každou minutu).
# Jeden engine obsluhuje víc nezávislých botů (profil = argument `tsx src/index.ts`,
# viz bridge-ts/src/config.ts) — každý se hlídá a startuje zvlášť, ať pád/restart
# jednoho neovlivní druhý. `$` v pgrep patternu pro assistant vylučuje shodu s
# "... index.ts zpravodaj" (bez profilu vs. s profilem).
#
# Každý restart se navíc loguje do SQLite (personal/dashboard/dashboard.sqlite) přes
# `record_restart`, ať to `personal/dashboard` umí zobrazit v historii — bash sám
# SQLite psát neumí (na hostu není `sqlite3` CLI), proto volání malého TS skriptu.
record_restart() {
    (cd /home/agent/agent-system/personal/dashboard && npx tsx src/recordRestart.ts "$1" "$2") >> /home/agent/agent-system/watchdog.log 2>&1
}

cd /home/agent/agent-system/bridge-ts || exit 1

if ! pgrep -f "tsx src/index.ts$" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (assistant) neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts >> /home/agent/agent-system/bridge_ts.log 2>&1 &
    record_restart "assistant" "proces neběžel"
fi

if ! pgrep -f "tsx src/index.ts zpravodaj" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (zpravodaj) neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts zpravodaj >> /home/agent/agent-system/bridge_ts_zpravodaj.log 2>&1 &
    record_restart "zpravodaj" "proces neběžel"
fi

if ! pgrep -f "tsx src/index.ts mailista" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (mailista) neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts mailista >> /home/agent/agent-system/bridge_ts_mailista.log 2>&1 &
    record_restart "mailista" "proces neběžel"
fi

if ! pgrep -f "tsx src/index.ts joby" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (joby) neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts joby >> /home/agent/agent-system/bridge_ts_joby.log 2>&1 &
    record_restart "joby" "proces neběžel"
fi

if ! pgrep -f "tsx src/index.ts nakup" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (nakup) neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts nakup >> /home/agent/agent-system/bridge_ts_nakup.log 2>&1 &
    record_restart "nakup" "proces neběžel"
fi

if ! pgrep -f "tsx.*personal/dashboard/src/index.ts" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') dashboard neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    (cd /home/agent/agent-system/personal/dashboard && nohup npx tsx /home/agent/agent-system/personal/dashboard/src/index.ts >> /home/agent/agent-system/dashboard.log 2>&1 &)
fi

if ! pgrep -f "tsx.*/personal/zpravodaj/webapp/server/src/index.ts$" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') zpravodaj-webapp neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    (cd /home/agent/agent-system/personal/zpravodaj/webapp/server && nohup npx tsx /home/agent/agent-system/personal/zpravodaj/webapp/server/src/index.ts >> /home/agent/agent-system/zpravodaj_webapp.log 2>&1 &)
fi
