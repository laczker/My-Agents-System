#!/bin/bash
# Deploys the merged rate-limit timeout fallback to the 7 remaining
# bridge-ts profiles (devbot already restarted separately). Same safe
# procedure as redeploy_rate_limit_fix.sh / restart_devbot.sh.
#
# Same self-kill class of bug as restart_devbot.sh (see its header comment
# and incident 2.10.): this script restarts "assistant" among other
# profiles, so if assistant itself is the one running it, it would be
# killing its own ancestor process the same way. Fixed the same way here:
# self-detach (fork + exit + setsid) before doing anything destructive, and
# re-enable the cron watchdog as soon as all profiles have been started
# instead of only after the trailing health-check loop.
#
# NOTE (left for a separate iteration, see personal/devbot/TASKS.md): the
# cron watchdog is still disabled for the whole stop-all-then-start-all
# loop across all 7 profiles (tens of seconds), not just per profile.
# Shrinking that further would mean restructuring the loop to
# disable/stop/start/re-enable per profile, which changes the race-
# avoidance reasoning for each profile individually -- a bigger, separate
# change, not done here.
set -u

LOG=/home/agent/agent-system/bridge_ts_switch.log
TAG=restart-remaining-20261001
ENV_FILE=/home/agent/agent-system/.env
CRON_BACKUP=/home/agent/agent-system/crontab_backup.txt

log() {
  echo "$(date -Iseconds) [$TAG] $1" >> "$LOG"
}

# Best-effort Telegram alert, same mechanism as restart_devbot.sh /
# personal/mailista/nightly_cleanup.sh. Uses the main (assistant) bot
# token since this script touches every profile, not just one bot.
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
      echo "$(date -Iseconds) [$TAG] cannot send alert: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID missing from $ENV_FILE" >> "$LOG"
      exit 0
    fi
    curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${text}" \
      -o /dev/null -w "  telegram HTTP %{http_code}\n" >> "$LOG" 2>&1
  )
}

# --- Self-detach (see restart_devbot.sh for the full rationale) ----------
if [ -z "${RESTART_REMAINING_DETACHED:-}" ]; then
  if ! command -v setsid >/dev/null 2>&1; then
    log "FATAL: setsid not available, refusing to run undetached (see incident 2.10.)"
    send_alert "⚠️ restart_remaining_profiles.sh: chybí příkaz setsid, restart jsem bezpečně odmítl spustit (cron watchdog zůstal beze změny)."
    exit 1
  fi
  RESTART_REMAINING_DETACHED=1 setsid "$0" "$@" < /dev/null >> "$LOG" 2>&1 &
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
    send_alert "⚠️ restart_remaining_profiles.sh selhal (exit $status), zkontroluj $LOG. Cron watchdog by měl být obnovený jako záchranná síť."
  fi
}
trap on_exit EXIT

log "restart sequence starting (pid $$)"

sleep 60

if ! crontab -l > "${CRON_BACKUP}.new" 2>/dev/null; then
  log "FATAL: cannot read current crontab, aborting before disabling watchdog"
  send_alert "⚠️ restart_remaining_profiles.sh: nepodařilo se přečíst crontab, restart jsem bezpečně odmítl (watchdog zůstal beze změny)."
  exit 1
fi
mv "${CRON_BACKUP}.new" "$CRON_BACKUP"
crontab -l | grep -v "watchdog.sh" | crontab -
log "cron watchdog disabled"

stop_profile() {
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
    log "$profile_label stopped (chain: $CHAIN_PIDS, claude: $CLAUDE_PID)"
  else
    log "$profile_label was not running"
  fi
}

stop_profile "assistant" 'src/index\.ts$'
sleep 3
stop_profile "zpravodaj" 'src/index\.ts zpravodaj'
sleep 3
stop_profile "mailista" 'src/index\.ts mailista'
sleep 3
stop_profile "joby" 'src/index\.ts joby'
sleep 3
stop_profile "nakup" 'src/index\.ts nakup'
sleep 3
stop_profile "fbalbums" 'src/index\.ts fbalbums'
sleep 3
stop_profile "trener" 'src/index\.ts trener'
sleep 2

if ! cd /home/agent/agent-system/bridge-ts; then
  log "FATAL: cannot cd to bridge-ts, aborting before start"
  exit 1
fi

declare -A PIDS
start_profile() {
  local profile_label="$1"
  local arg="$2"
  local logfile="$3"
  nohup npx tsx src/index.ts $arg >> "$logfile" 2>&1 &
  disown
  PIDS[$profile_label]=$!
  log "$profile_label started (pid ${PIDS[$profile_label]})"
  sleep 5
}

start_profile "assistant" "" /home/agent/agent-system/bridge_ts.log
start_profile "zpravodaj" "zpravodaj" /home/agent/agent-system/bridge_ts_zpravodaj.log
start_profile "mailista" "mailista" /home/agent/agent-system/bridge_ts_mailista.log
start_profile "joby" "joby" /home/agent/agent-system/bridge_ts_joby.log
start_profile "nakup" "nakup" /home/agent/agent-system/bridge_ts_nakup.log
start_profile "fbalbums" "fbalbums" /home/agent/agent-system/bridge_ts_fbalbums.log
start_profile "trener" "trener" /home/agent/agent-system/bridge_ts_trener.log

# Re-enable the watchdog now that all profiles have been (re)started --
# see header comment and restart_devbot.sh. The health check below still
# runs after this, so a failure there is still logged and alerted, but the
# watchdog is no longer held hostage to that check succeeding.
restore_cron

sleep 8
for label in assistant zpravodaj mailista joby nakup fbalbums trener; do
  pid="${PIDS[$label]}"
  if kill -0 "$pid" 2>/dev/null; then
    log "$label pid $pid still running after 8s, looks healthy"
  else
    log "WARNING: $label pid $pid is no longer running, check its log"
    send_alert "⚠️ restart_remaining_profiles.sh: $label (pid $pid) po 8s už neběží, zkontroluj log."
  fi
done

log "restart sequence finished"
