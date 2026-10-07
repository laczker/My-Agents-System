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

# Staggered starts: when many things are down at once (e.g. cron re-enabled after
# maintenance, host reboot) starting them all in one tick spikes memory on the ~3.7 GB
# host. Allow at most MAX_STARTS_PER_TICK starts (container up/recreate or host process)
# per run and sleep STAGGER_SECS between consecutive starts; anything over the cap is
# simply picked up by the next cron tick (the "is it down?" check is re-evaluated each
# minute). Call `throttle_start <label>` right before an action; non-zero = skip it.
MAX_STARTS_PER_TICK=2
STAGGER_SECS=15
STARTS_THIS_TICK=0
throttle_start() {
    if [ "$STARTS_THIS_TICK" -ge "$MAX_STARTS_PER_TICK" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') start of $1 deferred to next tick (limit $MAX_STARTS_PER_TICK starts per tick)" >> /home/agent/agent-system/watchdog.log
        return 1
    fi
    if [ "$STARTS_THIS_TICK" -gt 0 ]; then sleep "$STAGGER_SECS"; fi
    STARTS_THIS_TICK=$((STARTS_THIS_TICK + 1))
    return 0
}

cd /home/agent/agent-system/bridge-ts || exit 1

# Všech 6 denních profilů (nakup iter. 6, assistant iter. 7, zpravodaj/mailista/joby iter. 8, trener iter. 10) běží v daily-bots
# kontejneru místo na hostu — seznam profilů je v
# daily-profiles.txt. Dvoukrokové hlídání (ne jen pgrep uvnitř
# kontejneru přímo):
# 1) `docker compose ps` — pokud selže (daemon nedostupný), jen zalogovat a
#    nic nerestartovat, ať se netváří, že profil spadl, když problém je jinde
#    (stejná opatrnost jako u iterace 4, viz META_BOT.md §4a); pokud kontejner
#    neběží, normální `up -d`.
# 2) teprve když kontejner běží, `exec` pgrep na konkrétní proces uvnitř za
#    každý profil zvlášť — zachytí i pád jen jednoho z nich, co kontejner
#    (start-daily.sh/wait) sám nevyhodí. Container je sdílený, takže restart
#    kvůli jednomu spadlému profilu restartuje i ten druhý (force-recreate).
# Sdílený registr session (mounty v compose souborech): po rebootu /tmp zmizí a Docker by
# chybějící adresář vytvořil jako root, takže kontejner (uid 1000) by do něj nezapsal.
mkdir -p -m 700 /home/agent/.claude/sessions /tmp/cc-socks
# Single source of truth: daily-profiles.txt (also read by start-daily.sh in the container
# and by the dashboard). Fail loudly if missing/empty instead of silently watching nothing.
DAILY_PROFILES=$(cat /home/agent/agent-system/daily-profiles.txt 2>/dev/null)
if [ -z "$DAILY_PROFILES" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') daily-profiles.txt chybí nebo je prázdný, přeskakuji daily-bots kontrolu" >> /home/agent/agent-system/watchdog.log
fi
compose_ps_output=$(docker compose -f /home/agent/agent-system/docker-compose.daily.yml ps --status running --services 2>>/home/agent/agent-system/watchdog.log)
if [ $? -ne 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') docker compose ps pro daily-bots selhalo (daemon nedostupný?), přeskakuji" >> /home/agent/agent-system/watchdog.log
elif ! echo "$compose_ps_output" | grep -q "^daily-bots$"; then
  if throttle_start daily-bots; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') daily-bots kontejner neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    (cd /home/agent/agent-system && docker compose -f docker-compose.daily.yml up -d) >> /home/agent/agent-system/watchdog.log 2>&1
    for profile in $DAILY_PROFILES; do
        record_restart "$profile" "kontejner neběžel"
    done
  fi
else
    down_profiles=""
    for profile in $DAILY_PROFILES; do
        if [ "$profile" = "assistant" ]; then
            pattern="tsx src/index.ts$"
        else
            pattern="tsx src/index.ts $profile"
        fi
        if ! docker compose -f /home/agent/agent-system/docker-compose.daily.yml exec -T daily-bots pgrep -f "$pattern" > /dev/null 2>&1; then
            down_profiles="$down_profiles $profile"
        fi
    done
    if [ -n "$down_profiles" ] && throttle_start "daily-bots (down:$down_profiles)"; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (kontejner,$down_profiles) proces neběží, restartuji kontejner" >> /home/agent/agent-system/watchdog.log
        (cd /home/agent/agent-system && docker compose -f docker-compose.daily.yml up -d --force-recreate) >> /home/agent/agent-system/watchdog.log 2>&1
        for profile in $down_profiles; do
            record_restart "$profile" "proces v kontejneru neběžel"
        done
    fi
fi

# fbalbums (iterace 8, 6.10.) běží v project-bots kontejneru, stejné dvoukrokové
# hlídání jako daily-bots výš.
PROJECT_FILE=/home/agent/agent-system/docker-compose.project.yml
project_ps_output=$(docker compose -f "$PROJECT_FILE" ps --status running --services 2>>/home/agent/agent-system/watchdog.log)
if [ $? -ne 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') docker compose ps pro project-bots selhalo (daemon nedostupný?), přeskakuji" >> /home/agent/agent-system/watchdog.log
elif ! echo "$project_ps_output" | grep -q "^project-bots$"; then
  if throttle_start project-bots; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') project-bots kontejner neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    (cd /home/agent/agent-system && docker compose -f docker-compose.project.yml up -d) >> /home/agent/agent-system/watchdog.log 2>&1
    record_restart "fbalbums" "kontejner neběžel"
  fi
elif ! docker compose -f "$PROJECT_FILE" exec -T project-bots pgrep -f "tsx src/index.ts fbalbums" > /dev/null 2>&1 && throttle_start project-bots; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (kontejner, fbalbums) proces neběží, restartuji kontejner" >> /home/agent/agent-system/watchdog.log
    (cd /home/agent/agent-system && docker compose -f docker-compose.project.yml up -d --force-recreate) >> /home/agent/agent-system/watchdog.log 2>&1
    record_restart "fbalbums" "proces v kontejneru neběžel"
fi

if ! pgrep -f "tsx src/index.ts devbot" > /dev/null && throttle_start devbot; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts (devbot) neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts devbot >> /home/agent/agent-system/bridge_ts_devbot.log 2>&1 &
    record_restart "devbot" "proces neběžel"
fi

if ! pgrep -f "tsx.*personal/dashboard/src/index.ts" > /dev/null && throttle_start dashboard; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') dashboard neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    (cd /home/agent/agent-system/personal/dashboard && nohup npx tsx /home/agent/agent-system/personal/dashboard/src/index.ts >> /home/agent/agent-system/dashboard.log 2>&1 &)
fi

if ! pgrep -f "tsx.*/personal/zpravodaj/webapp/server/src/index.ts$" > /dev/null && throttle_start zpravodaj-webapp; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') zpravodaj-webapp neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    (cd /home/agent/agent-system/personal/zpravodaj/webapp/server && nohup npx tsx /home/agent/agent-system/personal/zpravodaj/webapp/server/src/index.ts >> /home/agent/agent-system/zpravodaj_webapp.log 2>&1 &)
fi
