#!/bin/bash
# Denní třídění inboxu — samostatný skript, nezávislý na sdíleném bridge-ts/
# CronCreate (viz META_BOT.md §3.5, DECISIONS.md 27.8.: CronCreate žije jen
# v paměti běžícího procesu a zmizí beze stopy při restartu/rate limitu).
#
# Historický balast v inboxu je dávno vyčištěný (viz CLEANUP_PROGRESS.md,
# status "done"). Tenhle skript proto běží jen JEDNOU DENNĚ (viz crontab) a
# roztřídí, co za den nateklo nového jako `is:unread in:inbox` — žádné
# opakované probouzení co 20 minut přes noc, to dřív jen zbytečně spouštělo
# desítky prázdných "ověřovacích" dávek (0 nové pošty) a plýtvalo to voláními
# (viz uživatelova zpětná vazba 11.9.: "proč tam celou noc něco běželo... to
# teď nechci... chci jen nějak přerozdělovat, ale to stačí jednou denně").
#
# Telegram zprávy: přesně jedna po doběhnutí dávky se souhrnem, plus okamžitá
# eskalace, pokud dávka najde něco, co potřebuje rozhodnutí hned. Při selhání
# jedna varovná zpráva, žádné automatické opakování do rána (další pokus je
# až zítřejší běh).
set -uo pipefail

DIR="/home/agent/agent-system/personal/mailista"
ENV_FILE="/home/agent/agent-system/.env.mailista"
LOG="$DIR/nightly_cleanup_log.txt"
LOCK="$DIR/.nightly_cleanup.lock"
PROGRESS_FILE="$DIR/CLEANUP_PROGRESS.md"

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

PROMPT=$(cat <<'EOF'
Proveď jednu denní dávku třídění inboxu podle pravidel v CLAUDE.md a
DECISIONS.md. Historický balast je už dávno vyčištěný (viz
CLEANUP_PROGRESS.md, status "done") — tahle dávka zpracovává jen to, co je
teď aktuálně nepřečtené v inboxu.

1. Spusť mcp__claude_ai_Gmail__search_threads s dotazem `is:unread in:inbox`,
   vezmi až 200 vláken z výsledku.

2. Pokud je výsledek 0 vláken, nic dál nedělej a rovnou vypiš BATCH_RESULT
   (viz níž) s nulami — NEPIŠ žádný záznam do CLEANUP_PROGRESS.md (žádná
   "ověřovací dávka", jen ticho, když není co dělat).

3. Pro každé vlákno rozhodni:
   - čistý marketing/newsletter/notifikace bez akční hodnoty → smaž
     (trash_thread) A ZÁROVEŇ unlabel_thread s labelIds=["UNREAD"],
   - vše ostatní (transakční potvrzení, bezpečnostní upozornění bez otevřené
     akce, staré vyřízené věci, pracovní/školní notifikace) → archivuj
     (unlabel_thread s labelIds=["INBOX","UNREAD"] v jednom volání),
   - cokoliv skutečně nejasného nebo finančně/bezpečnostně citlivého s
     otevřenou akcí → NECH NETKNUTÉ (nesahej na INBOX ani UNREAD), navíc
     přidej label_thread s labelIds=["Label_1"] (štítek "K-rozhodnutí"),
   - opakovaný marketingový odesílatel bez jasného unsubscribe → jen
     označ jako kandidáta na odhlášení (podle DECISIONS.md), samotné
     kliknutí na odhlášení dělá uživatel ručně.

4. Pokud jsi v kroku 3 něco zpracoval (tj. výsledek nebyl 0 vláken), připiš
   stručný záznam dávky do CLEANUP_PROGRESS.md (datum, počty
   smazáno/archivováno/stranou).

5. Pokud najdeš něco, co je potřeba hned eskalovat uživateli (bezpečnostní/
   finanční rozhodnutí, ne jen běžné "ponechat stranou"), přidej PŘED
   posledním řádkem výstupu jeden nebo víc řádků přesně ve tvaru:
   ESCALATE: <krátký česky popis, jedna věta>

Úplně poslední řádek výstupu (nic za ním) musí být přesně ve tvaru:
BATCH_RESULT: deleted=<N> archived=<M> pending=<P>

Nic jiného na závěr nepiš.
EOF
)

log "Start denní dávky"
OUTPUT=$(cd "$DIR" && claude -p "$PROMPT" --dangerously-skip-permissions 2>>"$LOG")
STATUS=$?

if [ $STATUS -ne 0 ] || [ -z "$OUTPUT" ]; then
  log "FAIL status=$STATUS"
  send_telegram "⚠️ Denní třídění inboxu dnes selhalo (status=$STATUS) — další pokus až zítra, mrkni na nightly_cleanup_log.txt."
  exit 1
fi

ESCALATE_LINES=$(echo "$OUTPUT" | grep '^ESCALATE:' || true)
if [ -n "$ESCALATE_LINES" ]; then
  send_telegram "⚠️ $(echo "$ESCALATE_LINES" | sed 's/^ESCALATE: //')"
fi

RESULT_LINE=$(echo "$OUTPUT" | grep '^BATCH_RESULT:' | tail -1)
DEL=$(echo "$RESULT_LINE" | sed -n 's/.*deleted=\([0-9]*\).*/\1/p')
ARCH=$(echo "$RESULT_LINE" | sed -n 's/.*archived=\([0-9]*\).*/\1/p')
PEND=$(echo "$RESULT_LINE" | sed -n 's/.*pending=\([0-9]*\).*/\1/p')
[ -z "$DEL" ] && DEL=0
[ -z "$ARCH" ] && ARCH=0
[ -z "$PEND" ] && PEND=0

log "OK deleted=$DEL archived=$ARCH pending=$PEND"

if [ "$DEL" = "0" ] && [ "$ARCH" = "0" ] && [ "$PEND" = "0" ]; then
  send_telegram "✅ Denní třídění inboxu: nic nového k roztřídění."
else
  send_telegram "✅ Denní třídění inboxu: smazáno ${DEL}, archivováno ${ARCH}, ponecháno k rozhodnutí ${PEND}."
fi
