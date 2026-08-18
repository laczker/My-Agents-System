# Úkoly — backlog

Průběžný seznam rozhodnutých/otevřených úkolů pro `personal/zpravodaj`, aby se
nemuselo spoléhat na `chat_history.txt` (drží jen pár posledních výměn) ani na paměť
v rámci jedné session. Hotové položky se mažou nebo přesouvají do `DECISIONS.md`,
pokud šlo o architektonické rozhodnutí.

## Hotovo

- **AI novinky** — implementace hotová, otestovaná a nasazená (18.8., viz
  `ai_news_digest.sh` a `DECISIONS.md`): `--model opus`, web search, dedupe přes
  `ai_news_seen.txt`, aktivní Telegram alert při selhání. Cron přidán: hodinový
  trigger, skript spustí research jen v pondělí 2:00 Europe/Prague (týdenní
  rytmus, potvrzeno uživatelem 18.8.), a pošle zprávu jen když je co hlásit.

- **Obsahové zadání** (17.8.) — zdroje, formát a čas domluveny s uživatelem, viz
  `DECISIONS.md`.

- **Proaktivní spouštění v 8:00** (17.–18.8.) — vyřešeno `daily_digest.sh`:
  samostatný skript nezávislý na `bridge-ts`, hodinový cron
  (`0 * * * * daily_digest.sh`) sám pozná pražských 8:00 a zavolá `claude -p` +
  pošle výsledek přímo přes Telegram Bot API. Otestováno, běží automaticky.
  (Poznámka: v TASKS.md tahle položka dřív omylem zůstala jako "otevřená" i po
  dokončení — zápis nebyl aktualizovaný po implementaci.)

- **Webovka pro čtení digestů** (zadáno 18.8. přes assistant-43: React+Node,
  historie vydání, Tailscale IP, ranní Telegram zpráva má nést jen odkaz+shrnutí
  místo plného textu) — dokončeno a otestováno 18.8. večer:
  - `webapp/client` (Vite+React) a `webapp/server` (čistý Node `http`, žádný
    framework) — zdrojáky hotové, `client` buildnutý do `client/dist`.
  - Server naslouchá na `100.108.179.97:8766` (stejná tailnet-only politika jako
    `personal/dashboard`), API `/api/digests` + `/api/digests/:id`, statické
    servírování buildnutého clientu.
  - `webapp/server/src/addDigest.ts` — CLI pro bash skripty, uloží digest do
    `webapp/data/digests.json` a vytiskne URL.
  - `daily_digest.sh` i `ai_news_digest.sh` upraveny: prompt teď vrací i
    jednořádkové shrnutí (`SHRNUTÍ:`/`TEASER:`), skript ho spolu s plným textem
    uloží přes `addDigest.ts` a do Telegramu pošle jen shrnutí + odkaz na
    webovku (fallback na starý plný text, pokud `addDigest` selže).
  - Server trvale zapojen do `watchdog.sh` (stejný vzor jako `personal/dashboard`
    blok) — **oprava bugu při zapojování**: první verze používala v `pgrep`
    vzoru relativní cestu (`src/index.ts` po `cd`), zatímco spouštěný proces měl
    v příkazové řádce taky jen relativní cestu → `pgrep` ho nikdy nenašel,
    watchdog spouštěl nový proces každou minutu → `EADDRINUSE` na portu 8766
    (identická třída chyby jako opakovaný pád `personal/dashboard`). Opraveno
    předáním absolutní cesty do `npx tsx` (stejně jako dashboard blok), ověřeno
    dvěma po sobě jdoucími běhy `watchdog.sh` bez duplicitního spuštění.
  - End-to-end ověřeno ručně (test digest přes `addDigest.ts` → vidět v
    `/api/digests` → smazáno, `digests.json` je teď prázdné `[]`, čeká na první
    reálný běh v 8:00/pondělí 2:00).
  - `webapp/` zatím není v gitu (`git status` ukazuje `?? webapp/`) — nekomitoval
    jsem bez výslovného pokynu.
  - Otevřené: ověřit při prvním skutečném cron běhu (zítra 8:00), že celý řetězec
    (prompt → parsing SHRNUTÍ/TEASER → addDigest → Telegram s odkazem) funguje i
    mimo ruční test.
</content>
