#!/bin/bash
# Jednorázový test-switch skript: čeká, až doručím aktuální odpověď přes bridge.py
# (velká rezerva, ne odhad na míru — viz DECISIONS.md, past z 17.8.), pak bridge.py
# zastaví a nahradí ho TS verzí pro živý test.
sleep 60

BRIDGE_PID=$(pgrep -f "python3 bridge.py")
if [ -n "$BRIDGE_PID" ]; then
  CHILD_PID=$(pgrep -P "$BRIDGE_PID")
  kill "$BRIDGE_PID" 2>/dev/null
  [ -n "$CHILD_PID" ] && kill "$CHILD_PID" 2>/dev/null
  echo "$(date -Iseconds) zastaven bridge.py (pid $BRIDGE_PID, child $CHILD_PID)" >> /home/agent/agent-system/bridge_ts_switch.log
else
  echo "$(date -Iseconds) bridge.py nebyl nalezen (už neběžel?)" >> /home/agent/agent-system/bridge_ts_switch.log
fi

sleep 2

cd /home/agent/agent-system/bridge-ts
nohup npx tsx src/index.ts >> /home/agent/agent-system/bridge_ts.log 2>&1 &
disown
echo "$(date -Iseconds) nastartován bridge-ts (pid $!)" >> /home/agent/agent-system/bridge_ts_switch.log
