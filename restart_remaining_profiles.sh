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
# re-enable the cron watchdog as soon as all profiles have been stopped
# instead of only after the trailing health-check loop.
#
# Incident 5.10. (see personal/assistant/DECISIONS.md, 1.10., and
# restart_devbot.sh): this script used to start each new process itself
# (`nohup npx tsx ... &` from this bash session), which inherits the
# environment of whatever invoked the script, not crontab's -- only
# crontab carries a valid CLAUDE_CODE_OAUTH_TOKEN. Fix: this script no
# longer starts anything -- after stopping all 7 old processes and
# re-enabling the cron watchdog, starting the new ones is left entirely to
# `watchdog.sh` (runs every minute via cron, so it inherits crontab's
# environment). The health check below now polls per profile for the
# cron-started process instead of checking a PID this script launched
# itself.
#
# NOTE (left for a separate iteration, see personal/devbot/TASKS.md): the
# cron watchdog is still disabled for the whole stop-all loop across all 7
# profiles (tens of seconds), not just per profile. Shrinking that further
# would mean restructuring the loop to disable/stop/re-enable per profile,
# which changes the race-avoidance reasoning for each profile individually
# -- a bigger, separate change, not done here.
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

declare -A OLD_PIDS
declare -A PATTERNS

stop_profile() {
  local profile_label="$1"
  local pgrep_pattern="$2"
  PATTERNS[$profile_label]="$pgrep_pattern"
  local CHAIN_PIDS
  CHAIN_PIDS=$(pgrep -f "$pgrep_pattern" | tr '\n' ' ')
  OLD_PIDS[$profile_label]="$CHAIN_PIDS"
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

# Re-enable the watchdog now that all 7 old processes have been stopped --
# see header comment. Starting new ones is no longer this script's job
# (incident 5.10.), so there's no reason to hold the watchdog off any
# longer than the stop loop above.
restore_cron

# --- Health check: wait for the cron watchdog to start new processes -----
# `watchdog.sh` runs every minute, so each new process can take up to ~60s
# to appear even when everything works; poll instead of a single fixed
# sleep. A PID counts as "new" only if it wasn't recorded in OLD_PIDS for
# that profile, since a straggler that ignored the kill above would
# otherwise look like a successful restart.
declare -A HEARTBEAT_FILES=(
  [assistant]=/home/agent/agent-system/personal/assistant/heartbeat_ts.txt
  [zpravodaj]=/home/agent/agent-system/personal/zpravodaj/heartbeat_ts.txt
  [mailista]=/home/agent/agent-system/personal/mailista/heartbeat_ts.txt
  [joby]=/home/agent/agent-system/personal/joby/heartbeat_ts.txt
  [nakup]=/home/agent/agent-system/personal/nakup/heartbeat_ts.txt
  [fbalbums]=/home/agent/agent-system/personal/fbalbums/heartbeat_ts.txt
  [trener]=/home/agent/agent-system/personal/trener/heartbeat_ts.txt
)

is_new_pid() {
  local label="$1"
  local pid="$2"
  case " ${OLD_PIDS[$label]} " in
    *" $pid "*) return 1 ;;
    *) return 0 ;;
  esac
}

HEALTH_TIMEOUT=90
HEALTH_INTERVAL=3
declare -A NEW_PIDS
PENDING="assistant zpravodaj mailista joby nakup fbalbums trener"
elapsed=0
while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ] && [ -n "$PENDING" ]; do
  STILL_PENDING=""
  for label in $PENDING; do
    CURRENT_PIDS=$(pgrep -f "${PATTERNS[$label]}" | tr '\n' ' ')
    found=""
    for pid in $CURRENT_PIDS; do
      if is_new_pid "$label" "$pid"; then
        found="$pid"
      fi
    done
    if [ -n "$found" ]; then
      NEW_PIDS[$label]="$found"
    else
      STILL_PENDING="$STILL_PENDING $label"
    fi
  done
  PENDING="${STILL_PENDING# }"
  [ -z "$PENDING" ] && break
  sleep "$HEALTH_INTERVAL"
  elapsed=$((elapsed + HEALTH_INTERVAL))
done

for label in assistant zpravodaj mailista joby nakup fbalbums trener; do
  pid="${NEW_PIDS[$label]:-}"
  if [ -z "$pid" ]; then
    log "WARNING: no new $label process detected within ${HEALTH_TIMEOUT}s of cron watchdog restart"
    send_alert "⚠️ restart_remaining_profiles.sh: cron watchdog do ${HEALTH_TIMEOUT}s nenahodil nový proces $label, zkontroluj log a crontab."
    continue
  fi
  log "new $label process detected (pid $pid)"
  # Give the fresh process a bit more time to get through npx/tsx startup
  # and its first touchHeartbeat() call before judging it unhealthy -- see
  # restart_devbot.sh for the same reasoning.
  hb_file="${HEARTBEAT_FILES[$label]}"
  HB_OK=0
  hb_elapsed=0
  while [ "$hb_elapsed" -lt 20 ]; do
    HB_TS=$(sed -n 's/.*"ts":\([0-9]*\).*/\1/p' "$hb_file" 2>/dev/null)
    NOW_MS=$(( $(date +%s%N) / 1000000 ))
    if [ -n "$HB_TS" ] && [ $((NOW_MS - HB_TS)) -ge 0 ] && [ $((NOW_MS - HB_TS)) -lt 30000 ]; then
      log "$label heartbeat fresh ($((NOW_MS - HB_TS))ms old)"
      HB_OK=1
      break
    fi
    sleep 2
    hb_elapsed=$((hb_elapsed + 2))
  done
  if [ "$HB_OK" -ne 1 ]; then
    log "WARNING: $label heartbeat missing or stale after ${hb_elapsed}s (file=$hb_file, ts=$HB_TS)"
    send_alert "⚠️ restart_remaining_profiles.sh: nový proces $label (pid $pid) běží, ale heartbeat vypadá neaktuálně nebo chybí, zkontroluj."
  fi
done

log "restart sequence finished"
