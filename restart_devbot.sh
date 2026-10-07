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
#   2. Re-enable the cron watchdog as soon as the old process has been
#      stopped, not as the last step gated on the health check below --
#      shrinks the window where the watchdog is off to roughly the stop
#      step instead of the whole script's runtime. A trap-based backstop
#      also re-enables it (and alerts) on any unexpected early exit; this
#      can't help against an unmaskable SIGKILL, but it keeps the window as
#      short as possible for everything else.
#
# Incident 5.10. (see personal/assistant/DECISIONS.md, 1.10.): this script
# used to start the new process itself (`nohup npx tsx ... &` from this
# bash session), which inherits the environment of whatever invoked the
# script, not crontab's. Only crontab carries a valid
# CLAUDE_CODE_OAUTH_TOKEN, so the self-started process ended up with a
# stale/missing token and failed with "OAuth session expired" twice between
# 09:04 and 09:35 before the cron watchdog eventually picked it up and
# fixed it. Fix: this script no longer starts anything -- after stopping
# the old process and re-enabling the cron watchdog, starting the new one
# is left entirely to `watchdog.sh` (runs every minute via cron, so it
# inherits crontab's environment). The health check below now polls for
# that cron-started process instead of checking a PID this script launched
# itself.
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
  RESTART_DEVBOT_DETACHED=1 setsid "$(readlink -f "$0")" "$@" < /dev/null >> "$LOG" 2>&1 &
  disown
  exit 0
fi

CRON_RESTORED=0
restore_cron() {
  [ "$CRON_RESTORED" = "1" ] && return
  if [ -f "$CRON_BACKUP" ]; then
    if crontab "$CRON_BACKUP"; then
      CRON_RESTORED=1
      log "cron watchdog re-enabled"
    else
      log "WARNING: crontab restore failed, will retry on next call/trap"
    fi
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

if ! crontab -l > "${CRON_BACKUP}.new" 2>/dev/null; then
  log "FATAL: cannot read current crontab, aborting before disabling watchdog"
  send_alert "⚠️ restart_devbot.sh: nepodařilo se přečíst crontab, restart jsem bezpečně odmítl (watchdog zůstal beze změny)."
  exit 1
fi
mv "${CRON_BACKUP}.new" "$CRON_BACKUP"
crontab -l | grep -v "watchdog.sh" | crontab -
log "cron watchdog disabled"

# Anchored with $ so a longer cmdline (e.g. "... devbot-foo") cannot match.
PGREP_PATTERN='src/index\.ts devbot$'
OLD_CHAIN_PIDS=$(pgrep -f "$PGREP_PATTERN" | tr '\n' ' ')
if [ -n "$OLD_CHAIN_PIDS" ]; then
  CLAUDE_PID=$(ps -eo pid,ppid,cmd | awk -v pids="$OLD_CHAIN_PIDS" '
    BEGIN { n = split(pids, a, " "); for (i = 1; i <= n; i++) set[a[i]] = 1 }
    $2 in set && $0 ~ /claude -p/ { print $1 }')
  [ -n "$CLAUDE_PID" ] && kill $CLAUDE_PID 2>/dev/null
  kill $OLD_CHAIN_PIDS 2>/dev/null
  log "devbot stopped (chain: $OLD_CHAIN_PIDS, claude: $CLAUDE_PID)"
else
  log "devbot was not running"
fi
sleep 2

# Re-enable the watchdog now -- see header comment. Starting the new
# process is no longer this script's job (incident 5.10.), so there's no
# reason to hold the watchdog off any longer than the stop step above.
restore_cron

# --- Health check: wait for the cron watchdog to start a new process -----
# `watchdog.sh` runs every minute, so a new devbot process can take up to
# ~60s to appear even when everything works; poll instead of a single
# fixed sleep. A PID counts as "new" only if it wasn't in OLD_CHAIN_PIDS,
# since a straggler that ignored the kill above would otherwise look like
# a successful restart.
HEALTH_TIMEOUT=90
HEALTH_INTERVAL=3
HEARTBEAT_FILE=/home/agent/agent-system/personal/devbot/heartbeat_ts.txt
elapsed=0
NEW_PID=""
while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
  CURRENT_PIDS=$(pgrep -f "$PGREP_PATTERN" | tr '\n' ' ')
  for pid in $CURRENT_PIDS; do
    case " $OLD_CHAIN_PIDS " in
      *" $pid "*) ;;
      *) NEW_PID="$pid" ;;
    esac
  done
  [ -n "$NEW_PID" ] && break
  sleep "$HEALTH_INTERVAL"
  elapsed=$((elapsed + HEALTH_INTERVAL))
done

if [ -z "$NEW_PID" ]; then
  log "WARNING: no new devbot process detected within ${HEALTH_TIMEOUT}s of cron watchdog restart"
  send_alert "⚠️ restart_devbot.sh: cron watchdog do ${HEALTH_TIMEOUT}s nenahodil nový proces devbota, zkontroluj bridge_ts_devbot.log a crontab."
else
  log "new devbot process detected (pid $NEW_PID) after ${elapsed}s"
  # Give the fresh process a bit more time to get through npx/tsx startup
  # and its first touchHeartbeat() call before judging it unhealthy --
  # the pgrep match above fires the moment the command line appears, which
  # can be a few seconds before the process has actually finished booting.
  HB_OK=0
  hb_elapsed=0
  while [ "$hb_elapsed" -lt 20 ]; do
    HB_TS=$(sed -n 's/.*"ts":\([0-9]*\).*/\1/p' "$HEARTBEAT_FILE" 2>/dev/null)
    NOW_MS=$(( $(date +%s%N) / 1000000 ))
    if [ -n "$HB_TS" ] && [ $((NOW_MS - HB_TS)) -ge 0 ] && [ $((NOW_MS - HB_TS)) -lt 30000 ]; then
      log "devbot heartbeat fresh ($((NOW_MS - HB_TS))ms old)"
      HB_OK=1
      break
    fi
    sleep 2
    hb_elapsed=$((hb_elapsed + 2))
  done
  if [ "$HB_OK" -ne 1 ]; then
    log "WARNING: devbot heartbeat missing or stale after ${hb_elapsed}s (file=$HEARTBEAT_FILE, ts=$HB_TS)"
    send_alert "⚠️ restart_devbot.sh: nový proces devbota (pid $NEW_PID) běží, ale heartbeat vypadá neaktuálně nebo chybí, zkontroluj."
  fi
fi

log "restart sequence finished"
