#!/bin/bash
# AI novinky — event-driven digest, nezávislý na daily_digest.sh.
# Spouští se hodinovým cronem a sám se ukončí, pokud zrovna není pondělí 2:00
# (Europe/Prague) — stejný DST-safe trik jako u daily_digest.sh (hodinový cron,
# skript sám pozná správný čas). Frekvence: jednou týdně (potvrzeno uživatelem
# 18.8., viz DECISIONS.md), ne vícekrát denně.
# I tak: pošle zprávu JEN pokud model najde skutečně relevantní novinku, kterou
# ještě neposlal (viz ai_news_seen.txt) — event-driven v tom smyslu, že prázdný
# týden nic neodešle.
#
# Výpadek (rate limit apod.): stejný marker mechanismus jako daily_digest.sh
# (viz DECISIONS.md, 24.8.) — OUTAGE_MARKER se založí při první chybě, varování
# jde JEN JEDNOU za výpadek, dokud marker existuje a není starší než
# OUTAGE_CAP_SECONDS se zkouší i mimo pondělní okno (bez dalších Telegram zpráv
# na neúspěch, jen log), po obnovení jedna potvrzující zpráva, po překročení
# stropu se to jednou nahlásí a čeká se na příští pondělní okno.
set -uo pipefail

DIR="/home/agent/agent-system/personal/zpravodaj"
ENV_FILE="/home/agent/agent-system/.env.zpravodaj"
LOG="$DIR/ai_news_log.txt"
LOCK="$DIR/.ai_news.lock"
SEEN_FILE="$DIR/ai_news_seen.txt"
WEBAPP_SERVER_DIR="$DIR/webapp/server"
TRIGGER_DAY="Mon"
TRIGGER_HOUR="02"
SEEN_MAX_LINES=300
NO_NEWS_MARK="ŽÁDNÉ NOVINKY"
OUTAGE_MARKER="$DIR/.ai_news_outage.marker"
OUTAGE_CAP_SECONDS=$((96 * 3600))

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

HOUR=$(TZ='Europe/Prague' date +%H)
DAY=$(TZ='Europe/Prague' date +%a)
RETRY_MODE=0
if [ "$DAY" != "$TRIGGER_DAY" ] || [ "$HOUR" != "$TRIGGER_HOUR" ]; then
  if [ -f "$OUTAGE_MARKER" ]; then
    MARKER_EPOCH=$(date -d "$(cat "$OUTAGE_MARKER")" +%s 2>/dev/null || echo 0)
    AGE=$(($(date +%s) - MARKER_EPOCH))
    if [ "$AGE" -gt "$OUTAGE_CAP_SECONDS" ]; then
      log "Outage marker starší než strop (>$((OUTAGE_CAP_SECONDS / 3600))h), vzdávám automatické opakování"
      send_telegram "⚠️ AI-news skript se nepodařilo rozběhnout ani po opakovaných pokusech přes $((OUTAGE_CAP_SECONDS / 3600)) hodin. Automatické opakování končí, zkusí se znovu až v příštím pondělním okně (2:00)."
      rm -f "$OUTAGE_MARKER"
      exit 0
    fi
    RETRY_MODE=1
  else
    exit 0
  fi
fi

touch "$SEEN_FILE"
SEEN_CONTENT=$(cat "$SEEN_FILE")

PROMPT=$(cat <<EOF
Sestav AI-novinky digest. Cílem je najít opravdu relevantní věci, ne generovat
report za každou cenu — je v pořádku a čekané, že většinu spuštění nebude co hlásit.

1. Pomocí web search prozkoumej aktuální AI novinky (posledních ~4-12 hodin, podle
   toho co najdeš) ve dvou oblastech:
   a) Praktické věci využitelné k programování a k vylepšování multi-agent systému
      podobného tomuhle (Claude Code / Claude Agent SDK, nové nástroje, nové
      techniky pro agenty, MCP, nové modely a jejich schopnosti) — včetně
      programátorských fór jako Hacker News (news.ycombinator.com) a
      r/programming, r/ClaudeAI, r/LocalLLaMA.
   b) Obecné AI novinky, světové i české.
   U technických věcí (a) udělej opravdu hloubkový research (přečti si víc než
   jen titulek, ověř z primárního zdroje pokud existuje, ne jen z druhotného
   článku) — nejde o rychlý přehled, ale o pochopení do hloubky.

2. Toto už bylo v minulých bězích odesláno, NEOPAKUJ tyhle odkazy ani stejné
   téma pod jiným odkazem:
$(if [ -n "$SEEN_CONTENT" ]; then echo "$SEEN_CONTENT"; else echo "(zatím nic)"; fi)

3. Pokud nic nového a opravdu relevantního nenajdeš, odpověz PŘESNĚ tímto textem
   a ničím jiným: $NO_NEWS_MARK

4. Pokud něco relevantního najdeš, odpověz v tomhle přesném formátu (žádný
   markdown, jde přímo do webové archivace a do Telegramu):

TITULEK: <krátký věcný titulek (cca 4-8 slov) hlavního nálezu/nálezů - klidně
víc témat oddělených čárkou, pokud jsou rovnocenná. ŽÁDNÝ clickbait.>

ODKAZY:
<jeden odkaz na řádek, jen ty které v reportu skutečně používáš>

TEASER: <JEDNA věta shrnující nejdůležitější nález/nálezy - jde do Telegram
zprávy místo celého textu, s odkazem na plné znění>

<samotný report v češtině, prostý text bez markdownu. Každá položka jako
odrážka v tomhle přesném tvaru:
"• Titulek věci (cca 3-6 slov, žádný clickbait) | pár vět vysvětlení do
hloubky (ne jen jedna věta u technických věcí) + zdrojový odkaz na konci."
Titulek, mezera-pipe-mezera, vysvětlení s odkazem na konci - žádná jiná
interpunkce mezi titulkem a pipe.>
EOF
)

log "Start ($DAY $HOUR:00)$([ "$RETRY_MODE" = "1" ] && echo " (opakování po výpadku)")"
OUTPUT=$(cd "$DIR" && claude -p "$PROMPT" --model opus --dangerously-skip-permissions 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  log "FAIL status=$STATUS output=$OUTPUT"
  if [ ! -f "$OUTAGE_MARKER" ]; then
    date -u +'%Y-%m-%dT%H:%M:%SZ' >"$OUTAGE_MARKER"
    send_telegram "⚠️ AI-news skript selhal (status=$STATUS), viz ai_news_log.txt na serveru. Zkusím to automaticky znovu v dalších hodinách, dokud to nevyjde (max $((OUTAGE_CAP_SECONDS / 3600))h) — další hlášku pošlu, až se to podaří nebo až to vzdám."
  fi
  exit 1
fi

RECOVERED=0
if [ -f "$OUTAGE_MARKER" ]; then
  rm -f "$OUTAGE_MARKER"
  RECOVERED=1
fi

TRIMMED=$(echo "$OUTPUT" | sed -e 's/[[:space:]]*$//')

if [ -z "$TRIMMED" ] || [ "$TRIMMED" = "$NO_NEWS_MARK" ]; then
  log "OK, nic relevantního"
  [ "$RECOVERED" = "1" ] && send_telegram "✅ Limit se mezitím obnovil, AI-news skript teď proběhl v pořádku (aktuálně bez nových relevantních novinek)."
  exit 0
fi

TITLE=$(echo "$OUTPUT" | awk '/^TITULEK:/{sub(/^TITULEK: */,""); print; exit}')
LINKS=$(echo "$OUTPUT" | awk '/^ODKAZY:/{f=1;next} f&&/^$/{exit} f')
TEASER=$(echo "$OUTPUT" | awk '/^TEASER:/{sub(/^TEASER: */,""); print; exit}')
BODY=$(echo "$OUTPUT" | awk 'BEGIN{seen=0;f=0} /^TEASER:/{seen=1;next} seen&&f==0&&/^$/{f=1;next} f{print}')

if [ -z "$BODY" ]; then
  # model neposlal očekávaný formát - pošli rovnou celý výstup, ať se neztratí
  BODY="$OUTPUT"
fi
[ -z "$TEASER" ] && TEASER="Nové AI novinky jsou k dispozici."
[ -z "$TITLE" ] && TITLE="AI novinky – $(TZ='Europe/Prague' date +%d.%m.%Y)"
TEASER_FILE=$(mktemp)
BODY_FILE=$(mktemp)
printf '%s' "$TEASER" >"$TEASER_FILE"
printf '%s' "$BODY" >"$BODY_FILE"
URL=$(cd "$WEBAPP_SERVER_DIR" && npx tsx src/addDigest.ts ai_news "$TITLE" "$TEASER_FILE" "$BODY_FILE" 2>>"$LOG")
ADD_STATUS=$?
rm -f "$TEASER_FILE" "$BODY_FILE"

RECOVERY_PREFIX=""
[ "$RECOVERED" = "1" ] && RECOVERY_PREFIX="✅ Limit se mezitím obnovil, AI-news se podařilo dodatečně sestavit:

"

if [ $ADD_STATUS -ne 0 ] || [ -z "$URL" ]; then
  log "WARN: addDigest selhal (status=$ADD_STATUS), posílám plný text jako fallback"
  send_telegram "${RECOVERY_PREFIX}🧠 $BODY"
else
  send_telegram "${RECOVERY_PREFIX}🧠 $TEASER

Celý report: $URL"
fi

if [ -n "$LINKS" ]; then
  {
    cat "$SEEN_FILE"
    echo "$LINKS"
  } | grep -v '^[[:space:]]*$' | tail -n "$SEEN_MAX_LINES" > "$SEEN_FILE.tmp"
  mv "$SEEN_FILE.tmp" "$SEEN_FILE"
fi

log "OK, odesláno, délka: ${#BODY} znaků, nových odkazů: $(echo "$LINKS" | grep -vc '^[[:space:]]*$')"
