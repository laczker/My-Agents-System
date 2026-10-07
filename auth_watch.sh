#!/bin/bash
# Detects "process runs but Claude auth doesn't work" (OAuth outage) and alerts via Telegram.
# Called from watchdog.sh once a minute. Never restarts anything: container credentials are
# read-only and refreshed only on the host, so a restart would not help.
#
# Signal: bridge-ts writes personal/<bot>/auth_error_ts.txt on an `auth_error` outcome and
# removes it after the next successful turn. A marker is ignored when ~/.claude/.credentials.json
# is newer than it (host re-login/refresh happened after the failure). Only a bot that
# processes a job can detect an outage; an idle fleet is not probed (no quota/RAM spent).
#
# ONE alert per outage (state file: empty -> non-empty set of affected bots), sent through the
# first affected bot's own Telegram token, and ONE recovery notice when the set is empty again.
# AUTH_WATCH_DRY_RUN=1 prints the message instead of calling Telegram.
ROOT=${AGENT_ROOT:-/home/agent/agent-system}
STATE=${AUTH_WATCH_STATE:-/tmp/auth_watch_state}
CREDS=${AUTH_WATCH_CREDS:-$HOME/.claude/.credentials.json}
LOG=$ROOT/watchdog.log

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') auth_watch: $*" >> "$LOG"; }

# send <profile> <text>: Telegram via .env.<profile> (subshell keeps the env clean)
send() {
    if [ "${AUTH_WATCH_DRY_RUN:-}" = "1" ]; then echo "[dry-run via $1] $2"; return 0; fi
    (
        set -a
        # shellcheck source=/dev/null
        source "$ROOT/.env.$1" 2>/dev/null
        set +a
        [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || exit 1
        curl -sS -m 20 -f -o /dev/null -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$2"
    ) >> "$LOG" 2>&1
}

affected=""
for profile in $(cat "$ROOT/daily-profiles.txt" 2>/dev/null) fbalbums devbot; do
    marker=$ROOT/personal/$profile/auth_error_ts.txt
    [ -f "$marker" ] || continue
    [ -f "$CREDS" ] && [ "$CREDS" -nt "$marker" ] && continue
    affected="$affected $profile"
done
affected=${affected# }

if [ -n "$affected" ] && [ ! -f "$STATE" ]; then
    # Create the state only after a successful send, so a failed send is retried next minute.
    if send "${affected%% *}" "🔐 Claude autentizace nefunguje (OAuth) u botů: $affected. Procesy běží, nic jsem nerestartoval — kontejnery mají credentials jen pro čtení, obnovit je musí host (claude login / otevřít claude na hostu). Další upozornění přijde až po obnovení."; then
        echo "$affected" > "$STATE"
        log "alert sent for: $affected"
    fi
elif [ -z "$affected" ] && [ -f "$STATE" ]; then
    prev=$(cat "$STATE")
    if send "${prev%% *}" "✅ Claude autentizace funguje zase (dříve postihnuto: $prev)."; then
        rm -f "$STATE"
        log "recovery notice sent (was: $prev)"
    fi
fi
