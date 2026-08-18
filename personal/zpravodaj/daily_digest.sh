#!/bin/bash
# Denní ranní zpravodaj — samostatný skript, nezávislý na sdíleném bridge-ts.
# Spouští se hodinovým cronem (viz níž) a sám se ukončí, pokud zrovna není 8:00
# pražského času — cron běží v UTC, tohle řeší přechod na letní/zimní čas bez
# nutnosti dvakrát ročně přepisovat crontab.
set -uo pipefail

DIR="/home/agent/agent-system/personal/zpravodaj"
ENV_FILE="/home/agent/agent-system/.env.zpravodaj"
LOG="$DIR/digest_log.txt"
LOCK="$DIR/.digest.lock"
WEBAPP_SERVER_DIR="$DIR/webapp/server"

exec 9>"$LOCK"
flock -n 9 || exit 0

HOUR=$(TZ='Europe/Prague' date +%H)
if [ "$HOUR" != "08" ]; then
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

PROMPT=$(cat <<'EOF'
Sestav dnešní ranní zpravodaj. Postupuj takto:

0. Na úplně první řádek napiš "SHRNUTÍ: " + JEDNU větu shrnující dnešní
   nejdůležitější témata napříč Českem i světem (jde do Telegram zprávy místo
   celého textu, s odkazem na plné znění). Pak jeden prázdný řádek. Teprve pak
   pokračuj samotným zpravodajem podle bodů níž.

1. Stáhni obsah těchto RSS feedů:
   - Alarm: https://denikalarm.cz/feed/ (pozor, bez koncového lomítka dělá redirect)
   - Deník N Česko: https://denikn.cz/cesko/feed
   - Deník N Svět: https://denikn.cz/svet/feed
   - iROZHLAS: https://www.irozhlas.cz/rss/irozhlas
   - Novinky.cz: https://www.novinky.cz/rss
   - Seznam Zprávy: https://www.seznamzpravy.cz/rss

2. Z každého feedu vezmi jen položky publikované za posledních 24 hodin (podle <pubDate>).

3. Vyber celkem cca 6-8 nejdůležitějších/nejzajímavějších položek. Rozděl je do
   dvou sekcí podle tématu (ne podle zdroje): Česko a Svět.

4. Ke každé položce napiš JEDNU větu shrnutí - POUZE na základě skutečně staženého
   title/description z feedu. Nic si nedomýšlej ani nedopisuj nad rámec staženého textu.

5. Za každou položku připoj přímý odkaz (<link> z feedu).

6. Pokud u některého zdroje za posledních 24 hodin nic relevantního není, zdroj v
   přehledu prostě vynech (nepiš, že nic nenašel).

Formát výstupu - DŮLEŽITÉ, jde přímo do webové archivace beze změny:
- Prostý text, ŽÁDNÝ markdown (žádné **, #, --- apod.)
- Úplně první řádek: "SHRNUTÍ: ..." podle bodu 0. Pak prázdný řádek.
- Pak samotný zpravodaj: první řádek dnešní datum, sekce "Česko" a "Svět",
  odrážky jako "• ".
- Vrať jako finální odpověď POUZE tohle - žádný úvod, žádné vysvětlování,
  žádné "Tady je váš zpravodaj:".
EOF
)

log "Start"
OUTPUT=$(cd "$DIR" && claude -p "$PROMPT" --dangerously-skip-permissions 2>>"$LOG")
STATUS=$?

if [ $STATUS -ne 0 ] || [ -z "$OUTPUT" ]; then
  log "FAIL status=$STATUS"
  send_telegram "⚠️ Ranní zpravodaj se dnes nepodařilo sestavit (chyba skriptu, viz digest_log.txt)."
  exit 1
fi

TEASER=$(echo "$OUTPUT" | awk '/^SHRNUTÍ:/{sub(/^SHRNUTÍ: */,""); print; exit}')
BODY=$(echo "$OUTPUT" | awk 'BEGIN{f=0} /^SHRNUTÍ:/{next} f==0&&/^$/{f=1;next} f{print}')
[ -z "$BODY" ] && BODY="$OUTPUT"
[ -z "$TEASER" ] && TEASER="Dnešní ranní zpravodaj je hotový."

TITLE="Ranní zpravodaj – $(TZ='Europe/Prague' date +%d.%m.%Y)"
TEASER_FILE=$(mktemp)
BODY_FILE=$(mktemp)
printf '%s' "$TEASER" >"$TEASER_FILE"
printf '%s' "$BODY" >"$BODY_FILE"
URL=$(cd "$WEBAPP_SERVER_DIR" && npx tsx src/addDigest.ts daily "$TITLE" "$TEASER_FILE" "$BODY_FILE" 2>>"$LOG")
ADD_STATUS=$?
rm -f "$TEASER_FILE" "$BODY_FILE"

if [ $ADD_STATUS -ne 0 ] || [ -z "$URL" ]; then
  log "WARN: addDigest selhal (status=$ADD_STATUS), posílám plný text jako fallback"
  send_telegram "$OUTPUT"
else
  send_telegram "$TEASER

Celý zpravodaj: $URL"
fi
log "OK, délka výstupu: ${#OUTPUT} znaků"
