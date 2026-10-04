#!/bin/bash
# Restart devbot's own bridge-ts profile to deploy a merged change
# (cron watchdog must be disabled first to avoid a 409 Conflict race with
# it restarting the same profile; 60s buffer before kill lets the in-flight
# reply that approved the merge finish sending before the process dies).
#
# Incident 2.10.: this script used to run as a plain foreground child of
# the very `claude -p` process it kills in the "stop old process" step
# below. Whatever tears down that process tree (the harness appears to kill
# its tracked child processes on shutdown) took the script down with it,
# between "stop old process" and "re-enable cron watchdog" -- so the
# watchdog stayed disabled for ~40h and nobody was told. Fixed two ways:
#   1. Self-detach before doing anything destructive: fork once and have
#      the original process exit immediately, so the real work runs as a
#      process reparented to init (not a child of whatever invoked this
#      script) inside its own session (setsid) -- immune to both "kill my
#      child PIDs" and "kill my whole process group" cleanup styles.
#      Verified with a throwaway test harness simulating the exact
#      scenario; see the commit message for the ps pid/ppid evidence.
#   2. Re-enable the cron watchdog as soon as the new process has been
#      started, not as the last step gated on the health check below --
#      shrinks the window where the watchdog is off to roughly the
#      stop+start step instead of the whole script's runtime. A trap-based
#      backstop also re-enables it (and alerts) on any unexpected early
#      exit; this can't help against an unmaskable SIGKILL, but it keeps
#      the window as short as possible for everything else.
set -u

LOG=/home/agent/agent-system/bridge_ts_switch.log
ENV_FILE=/home/agent/agent-system/.env.devbot
CRON_BACKUP=/home/agent/agent-system/crontab_backup.txt

log() {
  echo "$(date -Iseconds) [restart-devbot] $1" >> "$LOG"
}

# Best-effort Telegram alert so a failure isn't silently buried in a log
# file nobody is watching (same mechanism as
# personal/mailista/nightly_cleanup.sh's send_telegram -- see
# personal/devbot/CLAUDE.md "Skripty mimo bridge-ts"). Message text is
# Czech on purpose: it goes straight to the user's Telegram chat.
send_alert() {
  local text="$1"
  (
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE" 2>/dev/null
    set +a
    # Guard against unbound vars under `set -u` if the env file is missing
    # or doesn't define these -- the alert path itself must not crash
    # silently, since it's the thing that's supposed to report failures.
    if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
      echo "$(date -Iseconds) [restart-devbot] cannot send alert: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID missing from $ENV_FILE" >> "$LOG"
      exit 0
    fi
    curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${text}" \
      -o /dev/null -w "  telegram HTTP %{http_code}\n" >> "$LOG" 2>&1
  )
}

# --- Self-detach ---------------------------------------------------------
# Guarded re-exec: the first invocation forks a setsid'd copy of itself and
# exits right away, so the forked copy is reparented to init (not left as a
# child of whatever ran this script) and lives in a brand new session.
if [ -z "${RESTART_DEVBOT_DETACHED:-}" ]; then
  if ! command -v setsid >/dev/null 2>&1; then
    log "FATAL: setsid not available, refusing to run undetached (see incident 2.10.)"
    send_alert "⚠️ restart_devbot.sh: chybí příkaz setsid, restart devbota jsem bezpečně odmítl spustit (cron watchdog zůstal beze změny)."
    exit 1
  fi
  RESTART_DEVBOT_DETACHED=1 setsid "$0" "$@" < /dev/null >> "$LOG" 2>&1 &
  disown
  exit 0
fi

CRON_RESTORED=0
restore_cron() {
  [ "$CRON_RESTORED" = "1" ] && return
  if [ -f "$CRON_BACKUP" ]; then
    crontab "$CRON_BACKUP"
    CRON_RESTORED=1
    log "cron watchdog re-enabled"
  fi
}

on_exit() {
  local status=$?
  if [ "$CRON_RESTORED" != "1" ]; then
    restore_cron
  fi
  if [ "$status" -ne 0 ]; then
    log "WARNING: script exiting with status $status"
    send_alert "⚠️ restart_devbot.sh selhal (exit $status), zkontroluj $LOG. Cron watchdog by měl být obnovený jako záchranná síť."
  fi
}
trap on_exit EXIT

log "restart sequence starting (pid $$)"

sleep 60

crontab -l > "$CRON_BACKUP"
crontab -l | grep -v "watchdog.sh" | crontab -
log "cron watchdog disabled"

CHAIN_PIDS=$(pgrep -f "src/index\.ts devbot" | tr '\n' ' ')
if [ -n "$CHAIN_PIDS" ]; then
  CLAUDE_PID=$(ps -eo pid,ppid,cmd | awk -v pids="$CHAIN_PIDS" '
    BEGIN { n = split(pids, a, " "); for (i = 1; i <= n; i++) set[a[i]] = 1 }
    $2 in set && $0 ~ /claude -p/ { print $1 }')
  [ -n "$CLAUDE_PID" ] && kill $CLAUDE_PID 2>/dev/null
  kill $CHAIN_PIDS 2>/dev/null
  log "devbot stopped (chain: $CHAIN_PIDS, claude: $CLAUDE_PID)"
else
  log "devbot was not running"
fi
sleep 2

if ! cd /home/agent/agent-system/bridge-ts; then
  log "FATAL: cannot cd to bridge-ts, aborting before start"
  exit 1
fi
nohup npx tsx src/index.ts devbot >> /home/agent/agent-system/bridge_ts_devbot.log 2>&1 &
disown
NEWPID=$!
log "devbot started (pid $NEWPID)"

# Re-enable the watchdog now -- see header comment. If the health check
# below finds the new process unhealthy, the watchdog is already back on
# and will pick it up on its own next run.
restore_cron

sleep 8
if kill -0 "$NEWPID" 2>/dev/null; then
  log "devbot pid $NEWPID still running after 8s, looks healthy"
else
  log "WARNING: devbot pid $NEWPID is no longer running, check bridge_ts_devbot.log"
  send_alert "⚠️ restart_devbot.sh: nový proces devbota (pid $NEWPID) po 8s už neběží, zkontroluj bridge_ts_devbot.log."
fi

log "restart sequence finished"
