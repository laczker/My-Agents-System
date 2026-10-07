#!/bin/bash
# Restart devbot's own bridge-ts profile to deploy a merged change
# (cron watchdog must be disabled first to avoid a 409 Conflict race with
# it restarting the same profile; before the kill we wait until the in-flight
# turn has finished: job queue empty, outbox empty and no busy marker -- see "Quiesce" below).
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

# --- Quiesce: let the turn that triggered this restart finish -----------
# Old behaviour was a blind `sleep 60`, which cut off the reply of any turn
# longer than that. In bridge-ts/src/index.ts processQueue(), a finished job
# is shifted off job_queue_ts.json and, in the same synchronous tick, written
# to chat_history.txt and enqueued into outbox_ts.json (removed from there
# only after Telegram accepted it). So "queue has no jobs AND outbox is
# empty" on two consecutive polls means the turn is in history and delivered.
# Capped by QUIESCE_TIMEOUT: if it never settles (rate-limit wait keeps the
# job queued, Telegram down) we proceed anyway -- a job still in the queue is
# retried by the new process and the outbox is flushed on startup, so nothing
# is lost, only possibly delayed.
QUEUE_FILE=/home/agent/agent-system/personal/devbot/job_queue_ts.json
OUTBOX_FILE=/home/agent/agent-system/personal/devbot/outbox_ts.json
BUSY_FILE=/home/agent/agent-system/personal/devbot/busy_ts.txt
# bridge-ts writes BUSY_FILE for the whole duration of any turn, including
# unsolicited ones (cross-session SendMessage, cron wakeups) that never touch the
# queue. A marker older than BUSY_STALE_SEC is a leftover from a crash: ignored.
BUSY_STALE_SEC=${BUSY_STALE_SEC:-1800}
QUIESCE_TIMEOUT=${QUIESCE_TIMEOUT:-600}
QUIESCE_MIN_WAIT=${QUIESCE_MIN_WAIT:-5}

is_busy() {
  [ -f "$BUSY_FILE" ] || return 1
  local ts now_ms
  ts=$(sed -n 's/.*"ts":\([0-9]*\).*/\1/p' "$BUSY_FILE" 2>/dev/null)
  # Unparsable marker: treat as busy (the stale cap cannot be evaluated, the
  # QUIESCE_TIMEOUT still bounds the wait).
  [ -n "$ts" ] || return 0
  now_ms=$(( $(date +%s%N) / 1000000 ))
  [ $(( (now_ms - ts) / 1000 )) -lt "$BUSY_STALE_SEC" ]
}

is_quiet() {
  is_busy && return 1
  # Missing file counts as empty; unreadable/unparsable content does not.
  if [ -f "$QUEUE_FILE" ]; then
    # A job parked behind a rate-limit wait never finishes by itself: treat as
    # quiet (the new process replays it) instead of burning the whole timeout.
    tr -d ' \t\r\n' < "$QUEUE_FILE" | grep -Eq '"jobs":\[\]|"rateLimitResumeAtMs":[0-9]' || return 1
  fi
  if [ -f "$OUTBOX_FILE" ]; then
    [ "$(tr -d ' \t\r\n' < "$OUTBOX_FILE")" = "[]" ] || return 1
  fi
  return 0
}

sleep "$QUIESCE_MIN_WAIT"
q_start=$SECONDS
q_quiet=0
while [ $((SECONDS - q_start)) -lt "$QUIESCE_TIMEOUT" ]; do
  if is_quiet; then
    q_quiet=$((q_quiet + 1))
    [ "$q_quiet" -ge 2 ] && break
  else
    q_quiet=0
  fi
  sleep 2
done
if [ "$q_quiet" -ge 2 ]; then
  log "devbot quiescent (queue, outbox empty, no busy marker) after $((SECONDS - q_start + QUIESCE_MIN_WAIT))s"
else
  log "WARNING: devbot not quiescent after ${QUIESCE_TIMEOUT}s, restarting anyway (queued job is retried, outbox flushed on startup)"
  send_alert "⚠️ restart_devbot.sh: devbot do ${QUIESCE_TIMEOUT}s neutichl (fronta/outbox neprázdné nebo tah běží), restartuji i tak; rozpracovaný úkol se po startu zopakuje."
fi

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
