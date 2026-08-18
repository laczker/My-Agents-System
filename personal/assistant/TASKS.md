# Úkoly — backlog

Průběžný seznam rozhodnutých/otevřených úkolů, aby se nemuselo spoléhat na
`chat_history.txt` (drží jen pár posledních výměn) ani na paměť v rámci jedné session.
Formát: stav, krátký popis, co blokuje. Hotové položky se mažou nebo přesouvají do
`DECISIONS.md`, pokud šlo o architektonické rozhodnutí.

## Čeká na uživatele

- **Git pro `agent-system`** (18.8.) — celý `agent-system` (všichni tři boti,
  `bridge-ts`, `personal/dashboard/` až vznikne) je momentálně úplně mimo git,
  reálné riziko ztráty práce. Uživatel chce vyřešit sám, až bude mít čas — `git init`
  v kořeni + `.gitignore` na `.env*`, `*.log`, `__pycache__/`, `*.sqlite`,
  `bridge.py.bak.*` PŘED prvním commitem (kvůli tokenům v `.env` souborech).
- **Obsahové zadání zpravodaje** (jaké zdroje sledovat, jak často, jaký formát
  výstupu) — bot samotný na to uživatele čeká přímo ve svém vlastním chatu
  (`personal/zpravodaj/`), ne tady.
- **Obsahové zadání mailisty** (co přesně má s poštou dělat — upozorňovat, navrhovat
  odpovědi, třídit...) — bot samotný na to uživatele čeká přímo ve svém vlastním
  chatu (`personal/mailista/`), ne tady.

## Hotovo

- **Dashboard: sledování vyčerpání kvóty Claude Pro** (18.8.) — `personal/dashboard/`
  nově počítá kumulaci tokenů (`input + cache_creation`, bez `cache_read`) napříč
  všemi třemi boty (sdílí jeden účet) z existujícího `turn_log_ts.jsonl`, s resetem
  součtu při každém `rateLimited: true`. Přidán SVG graf (14 dní) + tabulka
  "Vyčerpání kvóty" (kdy, který bot, kolik tokenů od resetu, kdy se obnoví).
  Je to jen aproximace/korelace, ne přesné číslo Anthropicu. Dashboard restartován
  (`kill -TERM` + cron `watchdog.sh`), ověřeno na běžícím serveru.
- **Dashboard: sekce "Aktivita (posledních 24h)" + proklik na log + restart tlačítko**
  (18.8.) — tabulka s počtem tahů/chyb/průměrné délky/posledního cyklení kontextu
  na bota, čtená z `turn_log_ts.jsonl`; proklik na jméno bota otevře `/log/<bot>`
  se surovým JSONL; restart tlačítko u každého bota posílá `SIGTERM`, nahození
  nechává na cron watchdogu. Restart `assistant` tlačítkem ukončí i proces
  obsluhující telegramovou konverzaci (viz `DECISIONS.md`).
- **Nasazení tří oprav + token logging v `bridge-ts`** (18.8.) — rate-limit resume,
  globální `unhandledRejection`/`uncaughtException` handler, timeout→`kill()` v
  `send()`, plus nové logování jednoho řádku (`turn_log_ts.jsonl` v adresáři
  každého bota) při každém tahu: tokeny kontextu, `duration_ms`/`duration_api_ms`,
  `isError`, event proaktivního cyklení session. Cena (`total_cost_usd`) záměrně
  vynechána, uživatel má paušál (Claude Pro), útrata za tah ho nezajímá. Všichni
  tři boti restartováni (přes `kill -TERM` + cron `watchdog.sh`), ověřeno: jedna
  instance každého, heartbeaty čerstvé, restart zapsaný v historii dashboardu.
- **Zpravodaj infrastruktura** (17.8.) — samostatný proces/bot běží (`personal/zpravodaj/`,
  `bridge-ts`, vlastní Telegram token), heartbeat aktuální. Náplň (co má sledovat/
  posílat) ještě nedomluvená — viz "Čeká na uživatele" výše.
- **Mail agent infrastruktura** (17.8.) — samostatný proces/bot běží (`personal/mailista/`,
  `bridge-ts`, profil `mailista`, vlastní Telegram token `LukasuvMailistaBot`,
  přidán do `watchdog.sh`), heartbeat aktuální. Gmail MCP nástroje (`mcp__claude_ai_Gmail__*`)
  dostupné (connector je autorizovaný na úrovni účtu, ne per-projekt). Náplň ještě
  nedomluvená — viz "Čeká na uživatele" výše.

## Odloženo

- **Trvalý přístup do `personal/dashboard/` bez SSH tunelu** (18.8.) — dashboard dnes
  poslouchá jen na `127.0.0.1:8765`, uživatel se k němu prozatím dostane přes
  `ssh -L 8765:127.0.0.1:8765 <uživatel>@<server>` + `localhost:8765` v prohlížeči.
  Trvalé řešení (poslouchat i zvenku) by potřebovalo basic auth + řešení HTTPS/firewall —
  změna bezpečnostního nastavení, nízká autonomie dle `CLAUDE.md`, čeká na uživatelovo
  konkrétní zadání (auth metoda, port), až se k tomu dostane.
- **Agent na zakládání agentů** (Ludwigův `agentsmon new` vzor) — až budou existovat
  1-2 reální specialisté, na kterých se ustálí postup zakládání. Zatím zakládání dělá
  Claude přímo.
