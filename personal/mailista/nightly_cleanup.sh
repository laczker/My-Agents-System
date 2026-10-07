#!/bin/bash
# Daily inbox triage — standalone script, independent of the shared bridge-ts/
# CronCreate (see docs/META_BOT.md §3.5, DECISIONS.md 27.8.: CronCreate lives only
# in the running process's memory and vanishes without a trace on
# restart/rate limit).
#
# Historical backlog in the inbox was cleaned out long ago (see
# CLEANUP_PROGRESS.md, status "done"). This script therefore runs only ONCE
# A DAY (see crontab) and triages whatever came in that day as `is:unread
# in:inbox` — no more waking up every 20 minutes overnight, which used to
# fire off dozens of empty "check-in" batches (0 new mail) and waste calls
# (see user feedback 11.9.: "why was something running all night... I don't
# want that now... I just want it sorted, but once a day is enough").
#
# Triage has been five-category since 15.9. (see DECISIONS.md), not a binary
# delete/archive — deletion is a rare action reserved for senders explicitly
# listed in spam_senders.txt; uncertain marketing (LinkedIn etc.) only gets
# labeled and archived so the user can browse it themselves.
#
# Telegram messages: exactly one after the batch finishes, with a summary,
# plus an immediate escalation if the batch finds something that needs a
# decision right away. On failure, one warning message, no automatic retry
# until morning (the next attempt is tomorrow's run).
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
DECISIONS.md (zápis 15.9. — pět kategorií, ne binární smaž/archivuj).
Historický balast je už dávno vyčištěný (viz CLEANUP_PROGRESS.md, status
"done") — tahle dávka zpracovává jen to, co je teď aktuálně nepřečtené v
inboxu.

0. Přečti si spam_senders.txt v tomhle adresáři (seznam odesílatelů/domén,
   které uživatel výslovně označil jako "nikdy nechci vidět" — řádky
   začínající # jsou komentář). Ověř přes mcp__claude_ai_Gmail__list_labels,
   jestli existují štítky "K přečtení", "Účty a objednávky" a "Kandidát na
   odhlášení" — pokud ne, vytvoř je přes create_label a zapamatuj si jejich
   ID pro tuhle dávku. Štítek "K-rozhodnutí" má ověřené ID Label_1 (nemusíš
   hledat znovu).

   DŮLEŽITÉ — pokud jakékoliv volání `mcp__claude_ai_Gmail__*` v tomhle
   kroku (nebo kdekoliv dál) selže, spadne na chybu autorizace, nebo ty
   nástroje vůbec nejsou dostupné (nenajdeš je ani přes ToolSearch): tohle
   NENÍ totéž jako "0 vláken k zpracování". Okamžitě přestaň a jako úplně
   poslední řádek výstupu (nic za ním, ŽÁDNÝ BATCH_RESULT) vypiš přesně:
   BATCH_ERROR: <krátký česky popis příčiny, např. "Gmail MCP nástroje
   nedostupné" nebo "OAuth chyba při volání list_labels">
   Nedokončuj zbytek kroků, nepiš BATCH_RESULT s nulami — nulový výsledek
   smí znamenat jen "opravdu jsem se podíval a nic tam nebylo", ne "nemohl
   jsem se podívat".

1. Spusť mcp__claude_ai_Gmail__search_threads s dotazem `is:unread in:inbox`,
   vezmi až 200 vláken z výsledku. (Selhání tohohle volání = stejné pravidlo
   jako v kroku 0 výš — BATCH_ERROR, ne BATCH_RESULT s nulami.)

2. Pokud je výsledek 0 vláken, nic dál nedělej a rovnou vypiš BATCH_RESULT
   (viz níž) s nulami — NEPIŠ žádný záznam do CLEANUP_PROGRESS.md (žádná
   "ověřovací dávka", jen ticho, když není co dělat).

3. Pro každé vlákno rozhodni PRÁVĚ JEDNU primární kategorii:
   - **Čistý spam** (jen když odesílatel/doména JE na seznamu ze spam_senders.txt)
     → smaž (trash_thread) A ZÁROVEŇ unlabel_thread s labelIds=["UNREAD"].
   - **K rozhodnutí** — cokoliv skutečně nejasného nebo finančně/bezpečnostně
     citlivého s otevřenou akcí → NECH NETKNUTÉ (nesahej na INBOX ani
     UNREAD), navíc label_thread s labelIds=["Label_1"].
   - **Účty a objednávky** — transakční potvrzení, rezervace, e-shopy
     (Rohlík, Setmore, Ryanair apod.) → archivuj (unlabel_thread s
     labelIds=["INBOX","UNREAD"]) a přidej štítek "Účty a objednávky".
   - **K přečtení** — VŠECHNO OSTATNÍ, včetně marketingu/newsletterů/
     notifikací od odesílatelů, kteří NEJSOU na spam_senders.txt (typicky
     LinkedIn, pracovní/školní notifikace, obecné newslettery) → archivuj
     (unlabel_thread s labelIds=["INBOX","UNREAD"]) a přidej štítek
     "K přečtení". DŮLEŽITÉ: dokud odesílatel není výslovně na
     spam_senders.txt, nikdy nemaž jen na základě toho, že vlákno "vypadá
     jako marketing" — jde do K přečtení, ne do koše.

   Navíc (nezávisle na primární kategorii výš): pokud je odesílatel
   opakovaný marketingový/newsletterový zdroj bez jasného unsubscribe a
   ještě nemá štítek "Kandidát na odhlášení", přidej mu ho navíc k primární
   kategorii (typicky spolu s "K přečtení"). Jde jen o štítek — žádné
   klikání na unsubscribe odkaz, to dělá uživatel ručně.

4. Pokud jsi v kroku 3 něco zpracoval (tj. výsledek nebyl 0 vláken), připiš
   stručný záznam dávky do CLEANUP_PROGRESS.md (datum, počty po
   kategoriích).

5. Pokud najdeš něco, co je potřeba hned eskalovat uživateli (bezpečnostní/
   finanční rozhodnutí, ne jen běžné "K rozhodnutí"), přidej PŘED
   posledním řádkem výstupu jeden nebo víc řádků přesně ve tvaru:
   ESCALATE: <krátký česky popis, jedna věta>

Pokud jsi dávku dokončil bez chyby nástrojů, úplně poslední řádek výstupu
(nic za ním) musí být přesně ve tvaru:
BATCH_RESULT: deleted=<N> accounts=<M> toread=<R> pending=<P> unsubscribe=<U>

kde deleted=Čistý spam, accounts=Účty a objednávky, toread=K přečtení,
pending=K rozhodnutí, unsubscribe=kolik vláken navíc dostalo štítek
"Kandidát na odhlášení" (podmnožina toread/accounts, ne samostatná kategorie).
Nic jiného na závěr nepiš. Pokud jsi místo toho narazil na chybu nástrojů
podle pravidla v kroku 0/1 výš, vypiš místo něj BATCH_ERROR: <popis> a nic
jiného.
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

# BATCH_ERROR = the batch gave up on itself due to a tool error (e.g. Gmail
# MCP unavailable/OAuth) — the claude -p script's exit status is 0 in that
# case, so this is NOT covered by the check above. Must be distinguished
# from "genuinely 0 threads", otherwise it silently logs as OK with zeros
# (see #290, 16.9.).
BATCH_ERROR_LINE=$(echo "$OUTPUT" | grep '^BATCH_ERROR:' | tail -1)
if [ -n "$BATCH_ERROR_LINE" ]; then
  REASON=$(echo "$BATCH_ERROR_LINE" | sed 's/^BATCH_ERROR: //')
  log "FAIL (batch-error) $REASON"
  send_telegram "⚠️ Denní třídění inboxu dnes neproběhlo: ${REASON} — další pokus až zítra, mrkni na nightly_cleanup_log.txt."
  exit 1
fi

RESULT_LINE=$(echo "$OUTPUT" | grep '^BATCH_RESULT:' | tail -1)
if [ -z "$RESULT_LINE" ]; then
  log "FAIL (žádný BATCH_RESULT/BATCH_ERROR v výstupu — neočekávaný tvar)"
  send_telegram "⚠️ Denní třídění inboxu: neočekávaný výstup dávky (chybí BATCH_RESULT) — mrkni na nightly_cleanup_log.txt."
  exit 1
fi

DEL=$(echo "$RESULT_LINE" | sed -n 's/.*deleted=\([0-9]*\).*/\1/p')
ACC=$(echo "$RESULT_LINE" | sed -n 's/.*accounts=\([0-9]*\).*/\1/p')
TOREAD=$(echo "$RESULT_LINE" | sed -n 's/.*toread=\([0-9]*\).*/\1/p')
PEND=$(echo "$RESULT_LINE" | sed -n 's/.*pending=\([0-9]*\).*/\1/p')
UNSUB=$(echo "$RESULT_LINE" | sed -n 's/.*unsubscribe=\([0-9]*\).*/\1/p')
[ -z "$DEL" ] && DEL=0
[ -z "$ACC" ] && ACC=0
[ -z "$TOREAD" ] && TOREAD=0
[ -z "$PEND" ] && PEND=0
[ -z "$UNSUB" ] && UNSUB=0

log "OK deleted=$DEL accounts=$ACC toread=$TOREAD pending=$PEND unsubscribe=$UNSUB"

if [ "$DEL" = "0" ] && [ "$ACC" = "0" ] && [ "$TOREAD" = "0" ] && [ "$PEND" = "0" ]; then
  send_telegram "✅ Denní třídění inboxu: nic nového k roztřídění."
else
  MSG="✅ Denní třídění inboxu: 📰 K přečtení ${TOREAD}, 🛒 Účty a objednávky ${ACC}, 🗑️ smazáno ${DEL}, ⚠️ k rozhodnutí ${PEND}."
  if [ "$UNSUB" != "0" ]; then
    MSG="${MSG} (z toho 🔕 kandidát na odhlášení: ${UNSUB})"
  fi
  send_telegram "$MSG"
fi
