#!/bin/bash
# Per-bot cron: runs jobs declared in personal/<bot>/cron.txt, called from watchdog.sh
# once a minute. Lets a bot schedule a durable recurring job by committing a line to its
# own cron.txt, without touching the shared system crontab (see docs/META_BOT.md §3.5).
#
# Line format (same 5 fields as crontab, then a script path; '#' comments and blank
# lines are ignored):   minute hour day-of-month month day-of-week script [args...]
# Field syntax: *, N, a,b, a-b, */n (no names). Times are Europe/Prague.
# The script path is relative to personal/<bot>/ (or absolute) and must resolve (symlinks
# included) to an executable regular file inside that same directory — anything else is
# skipped and logged. Jobs run detached (setsid), stdout/stderr go to
# personal/<bot>/cron_stderr.txt. Overlap protection and Telegram failure alerts are the
# script's own job (flock, outage marker), as for the other cron scripts.
ROOT=${AGENT_ROOT:-/home/agent/agent-system}
LOG=$ROOT/watchdog.log
export TZ=Europe/Prague
read -r M H DOM MON DOW <<< "$(date '+%-M %-H %-d %-m %w')"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') cron.txt: $*" >> "$LOG"; }

# field_match <spec> <value> <min> <max>: 0 if value matches the cron field spec
field_match() {
    local spec=$1 val=$2 min=$3 max=$4 part range step lo hi
    local IFS=, rc=1
    set -f  # '*' must not glob
    for part in $spec; do
        step=1; range=$part
        if [[ $part == */* ]]; then range=${part%%/*}; step=${part##*/}; fi
        [[ $step =~ ^[0-9]+$ ]] && [ "$step" -gt 0 ] || continue
        if [ "$range" = "*" ]; then lo=$min; hi=$max
        elif [[ $range =~ ^[0-9]+$ ]]; then lo=$range; hi=$range; [ "$step" -gt 1 ] && hi=$max
        elif [[ $range =~ ^([0-9]+)-([0-9]+)$ ]]; then lo=${BASH_REMATCH[1]}; hi=${BASH_REMATCH[2]}
        else continue; fi
        if [ "$val" -ge "$lo" ] && [ "$val" -le "$hi" ] && [ $(( (val - lo) % step )) -eq 0 ]; then rc=0; break; fi
    done
    set +f
    return $rc
}

for file in "$ROOT"/personal/*/cron.txt; do
    [ -f "$file" ] || continue
    dir=$(dirname "$file"); bot=$(basename "$dir")
    realdir=$(realpath "$dir")
    while read -r f_min f_hour f_dom f_mon f_dow script args; do
        case "$f_min" in ''|'#'*) continue ;; esac
        field_match "$f_min" "$M" 0 59 && field_match "$f_hour" "$H" 0 23 \
            && field_match "$f_mon" "$MON" 1 12 || continue
        # dom/dow: like Vixie cron, if both are restricted either one may match
        dom_ok=1; dow_ok=1
        field_match "$f_dom" "$DOM" 1 31 || dom_ok=0
        field_match "$f_dow" "$DOW" 0 7 || { [ "$DOW" -eq 0 ] && field_match "$f_dow" 7 0 7; } || dow_ok=0
        if [ "$f_dom" != "*" ] && [ "$f_dow" != "*" ]; then
            [ $dom_ok -eq 1 ] || [ $dow_ok -eq 1 ] || continue
        else
            [ $dom_ok -eq 1 ] && [ $dow_ok -eq 1 ] || continue
        fi
        case "$script" in /*) path=$script ;; *) path=$dir/$script ;; esac
        real=$(realpath -e "$path" 2>/dev/null)
        if [ -z "$real" ] || [ ! -f "$real" ] || [ ! -x "$real" ] || [[ $real != "$realdir"/* ]]; then
            log "$bot: skipping '$script' (missing, not executable or outside personal/$bot)"
            continue
        fi
        log "$bot: starting $real"
        # shellcheck disable=SC2086  # args are intentionally word-split
        (cd "$dir" && setsid nohup "$real" $args >> "$dir/cron_stderr.txt" 2>&1 &)
    done < "$file"
done
exit 0
