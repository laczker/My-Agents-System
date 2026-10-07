#!/bin/bash
# Dvě denní připomínky "co jsi jedl/dělal" — samostatný skript, nezávislý na
# sdíleném bridge-ts. Spouští se hodinovým cronem (viz níž) a sám se ukončí,
# pokud zrovna není 13:00 nebo 23:00 pražského času — cron běží v UTC, tohle
# řeší přechod na letní/zimní čas bez nutnosti dvakrát ročně přepisovat
# crontab. Jde jen o statickou výzvu do Telegramu (Lukáš pak sám napíše
# odpověď do chatu, tu už zpracuje běžný bridge-ts tah jako normální zprávu).
#
# Výpadek: stejný vzor jako ostatní boti (viz personal/zpravodaj/daily_digest.sh).
# Marker se založí a varování pošle jen jednou za výpadek; dokud marker
# existuje a není starší než OUTAGE_CAP_SECONDS, skript zkouší i mimo cílová
# okna (hodinový cron jako retry).
set -uo pipefail

DIR="/home/agent/agent-system/personal/trener"
ENV_FILE="/home/agent/agent-system/.env.trener"
LOG="$DIR/checkin_log.txt"
LOCK="$DIR/.checkin.lock"
OUTAGE_MARKER="$DIR/.checkin_outage.marker"
OUTAGE_CAP_SECONDS=$((24 * 3600))

exec 9>"$LOCK"
flock -n 9 || exit 0

log() {
  echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') $1" >>"$LOG"
}

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

send_telegram() {
  local text="$1"
  curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${text}" \
    -o /dev/null -w "  telegram HTTP %{http_code}\n" 2>&1
}

HOUR=$(TZ='Europe/Prague' date +%H)

MESSAGE=""
SLOT=""
RETRY_MODE=0
if [ "$HOUR" = "13" ]; then
  SLOT="13:00"
  MESSAGE="Ahoj! Jak jde dnešní den — co jsi zatím jedl a stihl nějaký sport?"
elif [ "$HOUR" = "23" ]; then
  SLOT="23:00"
  MESSAGE="Večerní shrnutí — co jsi dnes ještě jedl/pil nebo dělal, ať to nezůstane nezapsané?"
elif [ -f "$OUTAGE_MARKER" ]; then
  MARKER_EPOCH=$(date -d "$(cat "$OUTAGE_MARKER")" +%s 2>/dev/null || echo 0)
  AGE=$(($(date +%s) - MARKER_EPOCH))
  if [ "$AGE" -gt "$OUTAGE_CAP_SECONDS" ]; then
    log "Outage marker starší než strop, vzdávám opakování do dalšího okna"
    send_telegram "⚠️ Jednu z denních připomínek (co jsi jedl/dělal) se nepodařilo odeslat ani po opakovaných pokusech přes $((OUTAGE_CAP_SECONDS / 3600)) hodin. Zkusí se znovu až v dalším pravidelném okně (13:00 nebo 23:00)."
    rm -f "$OUTAGE_MARKER"
    exit 0
  fi
  SLOT="retry"
  RETRY_MODE=1
  MESSAGE="(Nestihlo se poslat dřív.) Co jsi dnes jedl/pil nebo dělal, ať to nezůstane nezapsané?"
else
  exit 0
fi

log "Start ($SLOT)$([ "$RETRY_MODE" = "1" ] && echo " (opakování po výpadku)")"
OUTPUT=$(send_telegram "$MESSAGE")
echo "$OUTPUT" >>"$LOG"
if echo "$OUTPUT" | grep -q "HTTP 200"; then
  rm -f "$OUTAGE_MARKER"
  log "OK ($SLOT)"
else
  log "FAIL ($SLOT): $OUTPUT"
  if [ ! -f "$OUTAGE_MARKER" ]; then
    date -u +'%Y-%m-%dT%H:%M:%SZ' >"$OUTAGE_MARKER"
  fi
  exit 1
fi
