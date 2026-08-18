#!/bin/bash
# Trvalé přepnutí produkce na bridge-ts. Cron watchdog se na dobu přepnutí vypne,
# aby nenastal stejný 409 Conflict jako u testu (watchdog viděl "bridge.py neběží"
# a nastartoval ho zpátky, zatímco TS verze už pollovala stejný token).
LOG=/home/agent/agent-system/bridge_ts_switch.log

crontab -l > /home/agent/agent-system/crontab_backup.txt
crontab -l | grep -v "watchdog.sh" | crontab -
echo "$(date -Iseconds) cron watchdog docasne vypnut" >> "$LOG"

sleep 60

BRIDGE_PID=$(pgrep -f "python3 bridge.py" || true)
if [ -n "$BRIDGE_PID" ]; then
  CHILD_PID=$(pgrep -P "$BRIDGE_PID" || true)
  kill "$BRIDGE_PID" 2>/dev/null || true
  [ -n "$CHILD_PID" ] && kill "$CHILD_PID" 2>/dev/null || true
  echo "$(date -Iseconds) bridge.py zastaven (pid $BRIDGE_PID, child $CHILD_PID)" >> "$LOG"
else
  echo "$(date -Iseconds) bridge.py uz nebezel" >> "$LOG"
fi
sleep 2

cat > /home/agent/agent-system/watchdog.sh << 'EOF'
#!/bin/bash
# Restartuje bridge-ts, pokud neběží. Náhrada za systemd Restart=always —
# na hostu není dostupný root ani docker socket (viz DECISIONS.md), takže
# supervize jede přes cron (crontab -e, spouští se každou minutu).
cd /home/agent/agent-system/bridge-ts || exit 1
if ! pgrep -f "tsx src/index.ts" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') bridge-ts neběží, restartuji" >> /home/agent/agent-system/watchdog.log
    nohup npx tsx src/index.ts >> /home/agent/agent-system/bridge_ts.log 2>&1 &
fi
EOF
chmod +x /home/agent/agent-system/watchdog.sh
echo "$(date -Iseconds) watchdog.sh prepsan na TS variantu" >> "$LOG"

cd /home/agent/agent-system/bridge-ts
nohup npx tsx src/index.ts >> /home/agent/agent-system/bridge_ts.log 2>&1 &
disown
NEWPID=$!
echo "$(date -Iseconds) bridge-ts nastartovan (pid $NEWPID)" >> "$LOG"

sleep 8
if kill -0 "$NEWPID" 2>/dev/null; then
  echo "$(date -Iseconds) bridge-ts pid $NEWPID stale bezi po 8s, vypada zdrave" >> "$LOG"
else
  echo "$(date -Iseconds) VAROVANI: bridge-ts pid $NEWPID uz nebezi, zkontroluj bridge_ts.log" >> "$LOG"
fi

crontab /home/agent/agent-system/crontab_backup.txt
echo "$(date -Iseconds) cron watchdog znovu zapnut (hlida bridge-ts)" >> "$LOG"
