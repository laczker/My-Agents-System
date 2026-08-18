#!/bin/bash
# Nasazuje opravu "usage limit hláška = ztracený úkol" (viz DECISIONS.md,
# personal/assistant, 17.8.) + dřív odsouhlasený globální unhandledRejection/
# uncaughtException handler. Restartuje všechny tři instance bridge-ts
# (assistant, zpravodaj, mailista — sdílí stejný zdroják), sekvenčně s
# prodlevou, ať se nekoliduje na getUpdates hned po sobě. Stejný bezpečný
# postup jako `redeploy_eof_fix.sh` (cron watchdog dočasně vypnutý, 60s
# rezerva ať doběhne rozpracovaná odpověď, pak restart, pak cron zpět).
LOG=/home/agent/agent-system/bridge_ts_switch.log

crontab -l > /home/agent/agent-system/crontab_backup.txt
crontab -l | grep -v "watchdog.sh" | crontab -
echo "$(date -Iseconds) [redeploy-rate-limit-fix] cron watchdog docasne vypnut" >> "$LOG"

sleep 60

restart_profile() {
  local profile_label="$1"
  local pgrep_pattern="$2"
  local CHAIN_PIDS
  CHAIN_PIDS=$(pgrep -f "$pgrep_pattern" | tr '\n' ' ')
  if [ -n "$CHAIN_PIDS" ]; then
    local CLAUDE_PID
    CLAUDE_PID=$(ps -eo pid,ppid,cmd | awk -v pids="$CHAIN_PIDS" '
      BEGIN { n = split(pids, a, " "); for (i = 1; i <= n; i++) set[a[i]] = 1 }
      $2 in set && $0 ~ /claude -p/ { print $1 }')
    [ -n "$CLAUDE_PID" ] && kill $CLAUDE_PID 2>/dev/null
    kill $CHAIN_PIDS 2>/dev/null
    echo "$(date -Iseconds) [redeploy-rate-limit-fix] $profile_label zastaven (chain: $CHAIN_PIDS, claude: $CLAUDE_PID)" >> "$LOG"
  else
    echo "$(date -Iseconds) [redeploy-rate-limit-fix] $profile_label uz nebezel" >> "$LOG"
  fi
}

restart_profile "assistant" 'src/index\.ts$'
sleep 3
restart_profile "zpravodaj" 'src/index\.ts zpravodaj'
sleep 3
restart_profile "mailista" 'src/index\.ts mailista'
sleep 2

cd /home/agent/agent-system/bridge-ts

nohup npx tsx src/index.ts >> /home/agent/agent-system/bridge_ts.log 2>&1 &
disown
ASSISTANT_PID=$!
echo "$(date -Iseconds) [redeploy-rate-limit-fix] assistant nastartovan (pid $ASSISTANT_PID)" >> "$LOG"
sleep 5

nohup npx tsx src/index.ts zpravodaj >> /home/agent/agent-system/bridge_ts_zpravodaj.log 2>&1 &
disown
ZPRAVODAJ_PID=$!
echo "$(date -Iseconds) [redeploy-rate-limit-fix] zpravodaj nastartovan (pid $ZPRAVODAJ_PID)" >> "$LOG"
sleep 5

nohup npx tsx src/index.ts mailista >> /home/agent/agent-system/bridge_ts_mailista.log 2>&1 &
disown
MAILISTA_PID=$!
echo "$(date -Iseconds) [redeploy-rate-limit-fix] mailista nastartovan (pid $MAILISTA_PID)" >> "$LOG"

sleep 8
for pair in "assistant:$ASSISTANT_PID" "zpravodaj:$ZPRAVODAJ_PID" "mailista:$MAILISTA_PID"; do
  label="${pair%%:*}"
  pid="${pair##*:}"
  if kill -0 "$pid" 2>/dev/null; then
    echo "$(date -Iseconds) [redeploy-rate-limit-fix] $label pid $pid stale bezi po 8s, vypada zdrave" >> "$LOG"
  else
    echo "$(date -Iseconds) [redeploy-rate-limit-fix] VAROVANI: $label pid $pid uz nebezi, zkontroluj log" >> "$LOG"
  fi
done

crontab /home/agent/agent-system/crontab_backup.txt
echo "$(date -Iseconds) [redeploy-rate-limit-fix] cron watchdog znovu zapnut" >> "$LOG"
