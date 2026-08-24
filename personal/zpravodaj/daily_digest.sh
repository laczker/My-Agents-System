#!/bin/bash
# Denní ranní zpravodaj — samostatný skript, nezávislý na sdíleném bridge-ts.
# Spouští se hodinovým cronem (viz níž) a sám se ukončí, pokud zrovna není 8:00
# pražského času — cron běží v UTC, tohle řeší přechod na letní/zimní čas bez
# nutnosti dvakrát ročně přepisovat crontab.
#
# Výpadek (rate limit apod.): hlídá se markerem OUTAGE_MARKER (viz DECISIONS.md,
# 24.8.). Když run selže, marker se založí a varování pošle JEN JEDNOU za celý
# výpadek (ne při každém dalším pokusu). Dokud marker existuje a není starší než
# OUTAGE_CAP_SECONDS, skript se pokusí i mimo 8:00 okno (bere hodinový cron jako
# retry), ale bez dalších Telegram zpráv na neúspěch — jen log. Až run konečně
# projde, marker se smaže a pošle se JEDNA zpráva o obnovení. Pokud výpadek trvá
# déle než strop, automatické opakování se vzdá (taky jen jednou nahlásí) a čeká
# se na příští normální 8:00 okno.
set -uo pipefail

DIR="/home/agent/agent-system/personal/zpravodaj"
ENV_FILE="/home/agent/agent-system/.env.zpravodaj"
LOG="$DIR/digest_log.txt"
LOCK="$DIR/.digest.lock"
WEBAPP_SERVER_DIR="$DIR/webapp/server"
OUTAGE_MARKER="$DIR/.digest_outage.marker"
OUTAGE_CAP_SECONDS=$((48 * 3600))

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
RETRY_MODE=0
if [ "$HOUR" != "08" ] && [ -z "${FORCE_RUN:-}" ]; then
  if [ -f "$OUTAGE_MARKER" ]; then
    MARKER_EPOCH=$(date -d "$(cat "$OUTAGE_MARKER")" +%s 2>/dev/null || echo 0)
    AGE=$(($(date +%s) - MARKER_EPOCH))
    if [ "$AGE" -gt "$OUTAGE_CAP_SECONDS" ]; then
      log "Outage marker starší než strop (>$((OUTAGE_CAP_SECONDS / 3600))h), vzdávám automatické opakování"
      send_telegram "⚠️ Ranní zpravodaj se nepodařilo sestavit ani po opakovaných pokusech přes $((OUTAGE_CAP_SECONDS / 3600)) hodin. Automatické opakování končí, zkusí se znovu až v příštím ranním okně (8:00) — pokud to chceš dřív, spusť ručně FORCE_RUN=1."
      rm -f "$OUTAGE_MARKER"
      exit 0
    fi
    RETRY_MODE=1
  else
    exit 0
  fi
fi

PROMPT=$(cat <<'EOF'
Sestav dnešní ranní zpravodaj. Postupuj takto:

0. Na úplně první řádek napiš "TITULEK: " + krátký věcný titulek (cca 4-8 slov)
   shrnující hlavní téma/témata dneška - klidně víc témat oddělených čárkou,
   pokud jsou rovnocenná. ŽÁDNÝ clickbait (žádné "Šokující", "Nebudete věřit",
   otazníky navíc apod.) - jen věcně o čem dnešní zpravodaj je.

1. Na druhý řádek napiš "SHRNUTÍ: " + JEDNU větu shrnující dnešní
   nejdůležitější témata napříč Českem i světem (jde do Telegram zprávy místo
   celého textu, s odkazem na plné znění). Pak jeden prázdný řádek. Teprve pak
   pokračuj samotným zpravodajem podle bodů níž.

2. Stáhni obsah těchto RSS feedů:
   - Alarm: https://denikalarm.cz/feed/ (pozor, bez koncového lomítka dělá redirect)
   - Deník N Česko: https://denikn.cz/cesko/feed
   - Deník N Svět: https://denikn.cz/svet/feed
   - iROZHLAS: https://www.irozhlas.cz/rss/irozhlas
   - Novinky.cz: https://www.novinky.cz/rss
   - Seznam Zprávy: https://www.seznamzpravy.cz/rss

3. Z každého feedu vezmi jen položky publikované za posledních 24 hodin (podle <pubDate>).

4. Vyber celkem cca 6-8 nejdůležitějších/nejzajímavějších položek. Rozděl je do
   dvou sekcí podle tématu (ne podle zdroje): Česko a Svět.

5. Ke každé položce napiš krátký věcný titulek (cca 3-6 slov, ŽÁDNÝ clickbait) a
   za oddělovačem " | " JEDNU větu shrnutí - POUZE na základě skutečně staženého
   title/description z feedu. Nic si nedomýšlej ani nedopisuj nad rámec staženého textu.

6. Za větu shrnutí připoj přímý odkaz (<link> z feedu).

7. Pokud u některého zdroje za posledních 24 hodin nic relevantního není, zdroj v
   přehledu prostě vynech (nepiš, že nic nenašel).

Formát výstupu - DŮLEŽITÉ, jde přímo do webové archivace beze změny:
- Prostý text, ŽÁDNÝ markdown (žádné **, #, --- apod.)
- Úplně první řádek: "TITULEK: ..." podle bodu 0. Druhý řádek: "SHRNUTÍ: ..."
  podle bodu 1. Pak prázdný řádek.
- Pak samotný zpravodaj: první řádek dnešní datum, sekce "Česko" a "Svět",
  položky jako odrážky "• Titulek položky | Věta shrnutí. https://odkaz" -
  přesně v tomhle tvaru (titulek, mezera-pipe-mezera, věta, odkaz na konci).
- Vrať jako finální odpověď POUZE tohle - žádný úvod, žádné vysvětlování,
  žádné "Tady je váš zpravodaj:".
EOF
)

log "Start$([ "$RETRY_MODE" = "1" ] && echo " (opakování po výpadku)")"
OUTPUT=$(cd "$DIR" && claude -p "$PROMPT" --dangerously-skip-permissions 2>>"$LOG")
STATUS=$?

if [ $STATUS -ne 0 ] || [ -z "$OUTPUT" ]; then
  log "FAIL status=$STATUS"
  if [ ! -f "$OUTAGE_MARKER" ]; then
    date -u +'%Y-%m-%dT%H:%M:%SZ' >"$OUTAGE_MARKER"
    send_telegram "⚠️ Ranní zpravodaj se dnes nepodařilo sestavit (chyba skriptu, viz digest_log.txt). Zkusím to automaticky znovu v dalších hodinách, dokud to nevyjde (max $((OUTAGE_CAP_SECONDS / 3600))h) — další hlášku pošlu, až se to podaří nebo až to vzdám."
  fi
  exit 1
fi

RECOVERED=0
if [ -f "$OUTAGE_MARKER" ]; then
  rm -f "$OUTAGE_MARKER"
  RECOVERED=1
fi

TITLE=$(echo "$OUTPUT" | awk '/^TITULEK:/{sub(/^TITULEK: */,""); print; exit}')
TEASER=$(echo "$OUTPUT" | awk '/^SHRNUTÍ:/{sub(/^SHRNUTÍ: */,""); print; exit}')
BODY=$(echo "$OUTPUT" | awk 'BEGIN{f=0} /^TITULEK:/{next} /^SHRNUTÍ:/{next} f==0&&/^$/{f=1;next} f{print}')
[ -z "$BODY" ] && BODY="$OUTPUT"
[ -z "$TEASER" ] && TEASER="Dnešní ranní zpravodaj je hotový."
[ -z "$TITLE" ] && TITLE="Ranní zpravodaj – $(TZ='Europe/Prague' date +%d.%m.%Y)"
TEASER_FILE=$(mktemp)
BODY_FILE=$(mktemp)
printf '%s' "$TEASER" >"$TEASER_FILE"
printf '%s' "$BODY" >"$BODY_FILE"
URL=$(cd "$WEBAPP_SERVER_DIR" && npx tsx src/addDigest.ts daily "$TITLE" "$TEASER_FILE" "$BODY_FILE" 2>>"$LOG")
ADD_STATUS=$?
rm -f "$TEASER_FILE" "$BODY_FILE"

RECOVERY_PREFIX=""
[ "$RECOVERED" = "1" ] && RECOVERY_PREFIX="✅ Limit se mezitím obnovil, zpravodaj se podařilo dodatečně sestavit:

"

if [ $ADD_STATUS -ne 0 ] || [ -z "$URL" ]; then
  log "WARN: addDigest selhal (status=$ADD_STATUS), posílám plný text jako fallback"
  send_telegram "${RECOVERY_PREFIX}${OUTPUT}"
else
  send_telegram "${RECOVERY_PREFIX}${TEASER}

Celý zpravodaj: $URL"
fi
log "OK, délka výstupu: ${#OUTPUT} znaků"
