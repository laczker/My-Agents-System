#!/bin/bash
# Restarts bridge-ts processes if they're not running. Replacement for
# systemd Restart=always — root and the docker socket aren't available on
# the host (see DECISIONS.md), so supervision runs via cron (crontab -e,
# runs every minute).
# One engine serves multiple independent bots (profile = argument to
# `tsx src/index.ts`, see bridge-ts/src/config.ts) — each is watched and
# started separately, so a crash/restart of one doesn't affect another. The
# `$` in the pgrep pattern for assistant excludes a match with
# "... index.ts zpravodaj" (no profile vs. with a profile).
#
# Every restart is also logged to SQLite (personal/dashboard/dashboard.sqlite)
# via `record_restart`, so `personal/dashboard` can show it in history — bash
# itself can't write SQLite (no `sqlite3` CLI on the host), hence calling the
# small TS script.
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

if ! pgrep -f "tsx src/index.ts fbalbums" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (fbalbums) neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts fbalbums >> /home/agent/agent-system/bridge_ts_fbalbums.log 2>&1 &
    record_restart "fbalbums" "proces neběžel"
fi

if ! pgrep -f "tsx src/index.ts devbot" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (devbot) neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts devbot >> /home/agent/agent-system/bridge_ts_devbot.log 2>&1 &
    record_restart "devbot" "proces neběžel"
fi

if ! pgrep -f "tsx src/index.ts trener" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (trener) neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts trener >> /home/agent/agent-system/bridge_ts_trener.log 2>&1 &
    record_restart "trener" "proces neběžel"
fi

if ! pgrep -f "tsx.*personal/dashboard/src/index.ts" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') dashboard neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    (cd /home/agent/agent-system/personal/dashboard && nohup npx tsx /home/agent/agent-system/personal/dashboard/src/index.ts >> /home/agent/agent-system/dashboard.log 2>&1 &)
fi

if ! pgrep -f "tsx.*/personal/zpravodaj/webapp/server/src/index.ts$" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') zpravodaj-webapp neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    (cd /home/agent/agent-system/personal/zpravodaj/webapp/server && nohup npx tsx /home/agent/agent-system/personal/zpravodaj/webapp/server/src/index.ts >> /home/agent/agent-system/zpravodaj_webapp.log 2>&1 &)
fi

# Daily Docker container (docker-compose.daily.yml) — Docker pilot iteration 4.
# Deliberately commented out; reason and activation steps in META_BOT.md §4a
# and personal/devbot/TASKS.md ("Aktivace watchdog restartu kontejneru v cronu").
#
# compose_ps_output=$(docker compose -f /home/agent/agent-system/docker-compose.daily.yml ps --status running --services 2>>/home/agent/agent-system/watchdog.log)
# if [ $? -ne 0 ]; then
#     echo "$(date '+%Y-%m-%d %H:%M:%S') docker compose ps pro daily-bots selhalo (daemon nedostupný?), přeskakuji" >> /home/agent/agent-system/watchdog.log
# elif ! echo "$compose_ps_output" | grep -q "^daily-bots$"; then
#     echo "$(date '+%Y-%m-%d %H:%M:%S') daily-bots kontejner neběží, restartuji" >> /home/agent/agent-system/watchdog.log
#     (cd /home/agent/agent-system && docker compose -f docker-compose.daily.yml up -d) >> /home/agent/agent-system/watchdog.log 2>&1
#     record_restart "daily-bots-container" "kontejner neběžel"
# fi
