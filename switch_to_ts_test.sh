#!/bin/bash
# One-off test-switch script: waits until the current reply is delivered via
# bridge.py (a large safety margin, not a tight estimate — see DECISIONS.md,
# the 17.8. incident), then stops bridge.py and replaces it with the TS
# version for a live test.
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
