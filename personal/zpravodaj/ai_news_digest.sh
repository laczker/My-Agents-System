#!/bin/bash
# AI novinky — event-driven digest, nezávislý na daily_digest.sh.
# Spouští se hodinovým cronem a sám se ukončí, pokud zrovna není pondělí 2:00
# (Europe/Prague) — stejný DST-safe trik jako u daily_digest.sh (hodinový cron,
# skript sám pozná správný čas). Frekvence: jednou týdně (potvrzeno uživatelem
# 18.8., viz DECISIONS.md), ne vícekrát denně.
# I tak: pošle zprávu JEN pokud model najde skutečně relevantní novinku, kterou
# ještě neposlal (viz ai_news_seen.txt) — event-driven v tom smyslu, že prázdný
# týden nic neodešle.
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

exec 9>"$LOCK"
flock -n 9 || exit 0

HOUR=$(TZ='Europe/Prague' date +%H)
DAY=$(TZ='Europe/Prague' date +%a)
if [ "$DAY" != "$TRIGGER_DAY" ] || [ "$HOUR" != "$TRIGGER_HOUR" ]; then
  exit 0
fi

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

<samotný report v češtině, prostý text bez markdownu, každá položka: nadpis
věci + pár vět vysvětlení do hloubky (ne jen jedna věta u technických věcí) +
zdrojový odkaz na konci položky>
EOF
)

log "Start ($DAY $HOUR:00)"
OUTPUT=$(cd "$DIR" && claude -p "$PROMPT" --model opus --dangerously-skip-permissions 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  log "FAIL status=$STATUS output=$OUTPUT"
  send_telegram "⚠️ AI-news skript selhal (status=$STATUS), viz ai_news_log.txt na serveru."
  exit 1
fi

TRIMMED=$(echo "$OUTPUT" | sed -e 's/[[:space:]]*$//')

if [ -z "$TRIMMED" ] || [ "$TRIMMED" = "$NO_NEWS_MARK" ]; then
  log "OK, nic relevantního"
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

if [ $ADD_STATUS -ne 0 ] || [ -z "$URL" ]; then
  log "WARN: addDigest selhal (status=$ADD_STATUS), posílám plný text jako fallback"
  send_telegram "🧠 $BODY"
else
  send_telegram "🧠 $TEASER

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
