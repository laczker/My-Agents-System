#!/bin/bash
# Nasazuje dvě opravy najednou do bridge-ts (sdílený engine pro assistant i
# zpravodaj): (1) race condition v ClaudeProcess (kill()+start() nechávaly
# staré 'exit' eventy krást waitery nového procesu -> falešné EOF chyby při
# cyklení session i restartu po pádu), (2) retry/backoff na 409 Conflict při
# startu Telegram long-pollingu. Restartuje OBĚ instance (assistant i
# zpravodaj běží ze stejného zdrojáku), sekvenčně s prodlevou, ať se
# nekoliduje na getUpdates hned po sobě.
LOG=/home/agent/agent-system/bridge_ts_switch.log

crontab -l > /home/agent/agent-system/crontab_backup.txt
crontab -l | grep -v "watchdog.sh" | crontab -
echo "$(date -Iseconds) [redeploy-eof-fix] cron watchdog docasne vypnut" >> "$LOG"

sleep 60

restart_profile() {
  local profile_label="$1"
  local pgrep_pattern="$2"
  shift 2
  local CHAIN_PIDS
  CHAIN_PIDS=$(pgrep -f "$pgrep_pattern" | tr '\n' ' ')
  if [ -n "$CHAIN_PIDS" ]; then
    local CLAUDE_PID
    CLAUDE_PID=$(ps -eo pid,ppid,cmd | awk -v pids="$CHAIN_PIDS" '
      BEGIN { n = split(pids, a, " "); for (i = 1; i <= n; i++) set[a[i]] = 1 }
      $2 in set && $0 ~ /claude -p/ { print $1 }')
    [ -n "$CLAUDE_PID" ] && kill $CLAUDE_PID 2>/dev/null
    kill $CHAIN_PIDS 2>/dev/null
    echo "$(date -Iseconds) [redeploy-eof-fix] $profile_label zastaven (chain: $CHAIN_PIDS, claude: $CLAUDE_PID)" >> "$LOG"
  else
    echo "$(date -Iseconds) [redeploy-eof-fix] $profile_label uz nebezel" >> "$LOG"
  fi
}

restart_profile "assistant" 'src/index\.ts$'
sleep 3
restart_profile "zpravodaj" 'src/index\.ts zpravodaj'
sleep 2

cd /home/agent/agent-system/bridge-ts

nohup npx tsx src/index.ts >> /home/agent/agent-system/bridge_ts.log 2>&1 &
disown
ASSISTANT_PID=$!
echo "$(date -Iseconds) [redeploy-eof-fix] assistant nastartovan (pid $ASSISTANT_PID)" >> "$LOG"

sleep 5

nohup npx tsx src/index.ts zpravodaj >> /home/agent/agent-system/bridge_ts_zpravodaj.log 2>&1 &
disown
ZPRAVODAJ_PID=$!
echo "$(date -Iseconds) [redeploy-eof-fix] zpravodaj nastartovan (pid $ZPRAVODAJ_PID)" >> "$LOG"

sleep 8
if kill -0 "$ASSISTANT_PID" 2>/dev/null; then
  echo "$(date -Iseconds) [redeploy-eof-fix] assistant pid $ASSISTANT_PID stale bezi po 8s, vypada zdrave" >> "$LOG"
else
  echo "$(date -Iseconds) [redeploy-eof-fix] VAROVANI: assistant pid $ASSISTANT_PID uz nebezi, zkontroluj bridge_ts.log" >> "$LOG"
fi
if kill -0 "$ZPRAVODAJ_PID" 2>/dev/null; then
  echo "$(date -Iseconds) [redeploy-eof-fix] zpravodaj pid $ZPRAVODAJ_PID stale bezi po 8s, vypada zdrave" >> "$LOG"
else
  echo "$(date -Iseconds) [redeploy-eof-fix] VAROVANI: zpravodaj pid $ZPRAVODAJ_PID uz nebezi, zkontroluj bridge_ts_zpravodaj.log" >> "$LOG"
fi

crontab /home/agent/agent-system/crontab_backup.txt
echo "$(date -Iseconds) [redeploy-eof-fix] cron watchdog znovu zapnut" >> "$LOG"
