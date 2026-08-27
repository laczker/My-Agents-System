#!/bin/bash
# Noční dávkové čištění inboxu — samostatný skript, nezávislý na sdíleném
# bridge-ts/CronCreate (viz META_BOT.md §3.5, DECISIONS.md 27.8.: CronCreate
# žije jen v paměti běžícího procesu a zmizí beze stopy při restartu/rate
# limitu; přesně tohle se stalo v noci 26.-27.8., kdy noční čištění po pár
# dávkách potichu přestalo).
#
# Cron spouští tenhle skript každých 20 minut celý den (viz crontab níž);
# skript sám podle pražského času pozná, jestli má něco dělat:
#   - 00:00-05:59 Praha: jedna dávka (~100 vláken) čištění,
#   - 06:xx Praha (jednou denně): ranní shrnutí uplynulé noci,
#   - jinak: okamžitě skončí bez logu.
#
# Telegram zprávy za noc: přesně jedna na začátku ("pouštím se do..."), přesně
# jedna na konci (ranní shrnutí), plus okamžitá eskalace, pokud dávka najde
# něco, co potřebuje rozhodnutí hned. Nic mezi tím — viz CLAUDE.md "Noční
# dávková smyčka". Výpadek (rate limit apod.) uprostřed noci: JEDNA varovná
# zpráva při první chybě, tiché opakování dál, JEDNA zpráva při zotavení —
# stejný vzor jako personal/zpravodaj/daily_digest.sh (DECISIONS.md 24.8.),
# ne opakované hlášení téhož výpadku.
set -uo pipefail

DIR="/home/agent/agent-system/personal/mailista"
ENV_FILE="/home/agent/agent-system/.env.mailista"
LOG="$DIR/nightly_cleanup_log.txt"
LOCK="$DIR/.nightly_cleanup.lock"
PROGRESS_FILE="$DIR/CLEANUP_PROGRESS.md"
NIGHT_MARKER="$DIR/.night_marker.txt"
NIGHT_STATS="$DIR/.night_stats.txt"
SUMMARY_MARKER="$DIR/.summary_sent.marker"
OUTAGE_MARKER="$DIR/.nightly_cleanup_outage.marker"

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
  while [ -n "$text" ]; do
    local chunk="${text:0:4000}"
    text="${text:4000}"
    curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${chunk}" \
      -o /dev/null -w "  telegram HTTP %{http_code}\n" >>"$LOG" 2>&1
  done
}

PRAGUE_HOUR=$(TZ='Europe/Prague' date +%H)
PRAGUE_DATE=$(TZ='Europe/Prague' date +%Y-%m-%d)

# --- Ranní shrnutí (jednou denně, jakmile je pražská hodina 06) ---
if [ "$PRAGUE_HOUR" = "06" ]; then
  if [ -f "$NIGHT_MARKER" ] && [ "$(cat "$SUMMARY_MARKER" 2>/dev/null)" != "$PRAGUE_DATE" ]; then
    BATCHES=0; DEL=0; ARCH=0; PEND=0; FAILED=0
    if [ -f "$NIGHT_STATS" ]; then
      while read -r d a p; do
        BATCHES=$((BATCHES + 1)); DEL=$((DEL + d)); ARCH=$((ARCH + a)); PEND=$((PEND + p))
      done < <(grep -v '^FAIL$' "$NIGHT_STATS" || true)
      FAILED=$(grep -c '^FAIL$' "$NIGHT_STATS" 2>/dev/null || echo 0)
    fi
    MSG="🌅 Noční čištění inboxu skončilo. Dávek: ${BATCHES}, smazáno: ${DEL}, archivováno: ${ARCH}, ponecháno stranou k rozhodnutí: ${PEND}."
    [ "$FAILED" -gt 0 ] 2>/dev/null && MSG="${MSG} (${FAILED}x se dávku nepodařilo spustit, viz nightly_cleanup_log.txt.)"
    send_telegram "$MSG"
    log "Ranní shrnutí odesláno: batches=$BATCHES deleted=$DEL archived=$ARCH pending=$PEND failed=$FAILED"
    echo "$PRAGUE_DATE" >"$SUMMARY_MARKER"
    rm -f "$NIGHT_MARKER" "$NIGHT_STATS" "$OUTAGE_MARKER"
  fi
  exit 0
fi

# Mimo noční okno (00-05 Praha): nic dělat, žádný log (cron běží co 20 min
# celý den, ať se log nezanáší tisíci prázdnými řádky).
case "$PRAGUE_HOUR" in
  00 | 01 | 02 | 03 | 04 | 05) ;;
  *) exit 0 ;;
esac

RETRY_MODE=0
if [ "$(cat "$NIGHT_MARKER" 2>/dev/null)" != "$PRAGUE_DATE" ]; then
  echo "$PRAGUE_DATE" >"$NIGHT_MARKER"
  : >"$NIGHT_STATS"
  rm -f "$OUTAGE_MARKER"
  send_telegram "⏳ Pouštím se do nočního čištění inboxu."
elif [ -f "$OUTAGE_MARKER" ]; then
  RETRY_MODE=1
fi

PROMPT=$(cat <<'EOF'
Pokračuj v hromadném nočním čištění inboxu podle stavu v souboru
CLEANUP_PROGRESS.md (v aktuálním adresáři) a pravidel v CLAUDE.md.

1. Přečti CLEANUP_PROGRESS.md, najdi sekci "Kde pokračovat příští dávkou" a
   zjisti přesný Gmail search dotaz (`is:unread in:inbox after:... before:...`),
   od kterého navázat.

2. Spusť ten dotaz (mcp__claude_ai_Gmail__search_threads), vezmi až 100
   vláken z výsledku.

3. Pro každé vlákno rozhodni:
   - čistý marketing/newsletter/notifikace bez akční hodnoty → smaž
     (trash_thread),
   - vše ostatní (transakční potvrzení, bezpečnostní upozornění bez otevřené
     akce, staré vyřízené věci, pracovní/školní notifikace) → archivuj
     (unlabel_thread, odeber label INBOX),
   - cokoliv skutečně nejasného nebo finančně/bezpečnostně citlivého s
     otevřenou akcí (např. možný únik hesla vyžadující rozhodnutí) → NECH
     NETKNUTÉ a zapiš do "čeká na rozhodnutí".

4. Zapiš novou dávku do CLEANUP_PROGRESS.md ve stejném stylu jako dosavadní
   záznamy (číslo dávky, rozsah dat, počty smazáno/archivováno/stranou,
   poznámka k novým kategoriím), aktualizuj "Kde pokračovat příští dávkou" a
   průběžné součty.

5. Pokud najdeš něco, co je potřeba hned eskalovat uživateli (bezpečnostní/
   finanční rozhodnutí, ne jen běžné "ponechat stranou"), přidej PŘED
   posledním řádkem výstupu jeden nebo víc řádků přesně ve tvaru:
   ESCALATE: <krátký česky popis, jedna věta>

6. Pokud dotaz z bodu 1 vrátí 0 vláken A ověříš (`is:unread in:inbox` bez
   dalšího omezení dat), že už nezbývá žádné historické nepřečtené vlákno
   starší než současnost, nastav status na "done" místo "continue".

Úplně poslední řádek výstupu (nic za ním) musí být přesně ve tvaru:
BATCH_RESULT: deleted=<N> archived=<M> pending=<P> status=<continue|done>

Nic jiného na závěr nepiš.
EOF
)

log "Start dávky$([ "$RETRY_MODE" = "1" ] && echo " (opakování po výpadku)")"
OUTPUT=$(cd "$DIR" && claude -p "$PROMPT" --dangerously-skip-permissions 2>>"$LOG")
STATUS=$?

if [ $STATUS -ne 0 ] || [ -z "$OUTPUT" ]; then
  log "FAIL status=$STATUS"
  echo "FAIL" >>"$NIGHT_STATS"
  if [ ! -f "$OUTAGE_MARKER" ]; then
    date -u +'%Y-%m-%dT%H:%M:%SZ' >"$OUTAGE_MARKER"
    send_telegram "⚠️ Noční dávka teď selhala (nejspíš limit) — zkusím to automaticky dál po zbytek noci, další zprávu pošlu až se to podaří nebo v ranním shrnutí."
  fi
  exit 1
fi

RECOVERED=0
if [ -f "$OUTAGE_MARKER" ]; then
  rm -f "$OUTAGE_MARKER"
  RECOVERED=1
fi

ESCALATE_LINES=$(echo "$OUTPUT" | grep '^ESCALATE:' || true)
if [ -n "$ESCALATE_LINES" ]; then
  send_telegram "⚠️ $(echo "$ESCALATE_LINES" | sed 's/^ESCALATE: //')"
fi

RESULT_LINE=$(echo "$OUTPUT" | grep '^BATCH_RESULT:' | tail -1)
DEL=$(echo "$RESULT_LINE" | sed -n 's/.*deleted=\([0-9]*\).*/\1/p')
ARCH=$(echo "$RESULT_LINE" | sed -n 's/.*archived=\([0-9]*\).*/\1/p')
PEND=$(echo "$RESULT_LINE" | sed -n 's/.*pending=\([0-9]*\).*/\1/p')
STAT=$(echo "$RESULT_LINE" | sed -n 's/.*status=\([a-z]*\).*/\1/p')
[ -z "$DEL" ] && DEL=0
[ -z "$ARCH" ] && ARCH=0
[ -z "$PEND" ] && PEND=0
[ -z "$STAT" ] && STAT="unknown"

echo "$DEL $ARCH $PEND" >>"$NIGHT_STATS"
log "OK deleted=$DEL archived=$ARCH pending=$PEND status=$STAT"

if [ "$RECOVERED" = "1" ]; then
  send_telegram "✅ Limit se mezitím obnovil, dávka teď proběhla dodatečně."
fi

if [ "$STAT" = "done" ]; then
  send_telegram "✅ Historický balast inboxu je vyčištěný — noční dávkové čištění dosáhlo současnosti. Zbytek nových zpráv se dál řeší podle potřeby."
  rm -f "$NIGHT_MARKER"
fi
