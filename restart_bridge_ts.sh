#!/bin/bash
# Restart bridge-ts kvůli nasazení kódové změny (proaktivní cyklení session).
# Normální restart, ne proaktivní cyklus — session_id.txt zůstává, --resume se
# použije jako obvykle, kontext se nezahazuje.
LOG=/home/agent/agent-system/bridge_ts_switch.log

crontab -l > /home/agent/agent-system/crontab_backup.txt
crontab -l | grep -v "watchdog.sh" | crontab -
echo "$(date -Iseconds) [redeploy] cron watchdog docasne vypnut" >> "$LOG"

sleep 60

# Přesně najít claude subprocess, co je potomkem TÉHLE instance bridge-ts (ne
# libovolný jiný "claude -p" proces na hostu) — přes shodu rodičovského PID.
CHAIN_PIDS=$(pgrep -f "src/index\.ts" | tr '\n' ' ')
if [ -n "$CHAIN_PIDS" ]; then
  CLAUDE_PID=$(ps -eo pid,ppid,cmd | awk -v pids="$CHAIN_PIDS" '
    BEGIN { n = split(pids, a, " "); for (i = 1; i <= n; i++) set[a[i]] = 1 }
    $2 in set && $0 ~ /claude -p/ { print $1 }')
  [ -n "$CLAUDE_PID" ] && kill $CLAUDE_PID 2>/dev/null
  kill $CHAIN_PIDS 2>/dev/null
  echo "$(date -Iseconds) [redeploy] bridge-ts zastaven (chain: $CHAIN_PIDS, claude: $CLAUDE_PID)" >> "$LOG"
else
  echo "$(date -Iseconds) [redeploy] bridge-ts uz nebezel" >> "$LOG"
fi
sleep 2

cd /home/agent/agent-system/bridge-ts
nohup npx tsx src/index.ts >> /home/agent/agent-system/bridge_ts.log 2>&1 &
disown
NEWPID=$!
echo "$(date -Iseconds) [redeploy] bridge-ts nastartovan (pid $NEWPID)" >> "$LOG"

sleep 8
if kill -0 "$NEWPID" 2>/dev/null; then
  echo "$(date -Iseconds) [redeploy] bridge-ts pid $NEWPID stale bezi po 8s, vypada zdrave" >> "$LOG"
else
  echo "$(date -Iseconds) [redeploy] VAROVANI: bridge-ts pid $NEWPID uz nebezi, zkontroluj bridge_ts.log" >> "$LOG"
fi

crontab /home/agent/agent-system/crontab_backup.txt
echo "$(date -Iseconds) [redeploy] cron watchdog znovu zapnut" >> "$LOG"
