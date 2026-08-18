# Úkoly — backlog

Průběžný seznam rozhodnutých/otevřených úkolů, aby se nemuselo spoléhat na
`chat_history.txt` (drží jen pár posledních výměn) ani na paměť v rámci jedné session.
Formát: stav, krátký popis, co blokuje. Hotové položky se mažou nebo přesouvají do
`DECISIONS.md`, pokud šlo o architektonické rozhodnutí.

## Čeká na uživatele

(momentálně nic)

## Rozpracováno

- **Google/research agent (deep research)** — zjištěno (18.8., subagent prohledal
  `/tmp/Agent2Telegram`, ne `/tmp/AgentsMonitoring` — to je jen supervisor bez
  research/model logiky): Ludwigův bridge nemá žádný vlastní deep-research vzor,
  research plně deleguje na nativní nástroje CLI (`WebSearch`/`WebFetch`/sub-agent
  `Task`) — stejně jako to dělám já přes `Agent` tool. Model per bot je u něj čistě
  statický přes přepsání `command` pole v configu (`--model` flag), žádné
  automatické přepínání podle úkolu. Čeká se na uživatele, jestli chce (a) ad-hoc
  subagent zde v assistant chatu, nebo (b) samostatný bot s vlastním configem/
  Telegram chatem a `--model opus` staticky nastaveným.
- **Nahrávání souborů/obrázků přes Telegram** — potřeba zjistit, jestli `bridge-ts`
  dnes umí přijmout přílohu a předat ji do `claude -p`. Zatím neprozkoumáno.
- **Zpravodaj: obsahové zadání AI novinky + obecné zprávy** (18.8.) — zadání
  poslané přímo do chatu `zpravodaj-31` (SendMessage): AI novinky světové i lokální
  se zaměřením na programování a vylepšování tohoto systému (deep research u
  technických věcí, ne povrchní), + obecné zprávy ČR/svět (stačí zajímavé), bez
  nucené denní frekvence. Zpravodaj si to zapsal do vlastních `DECISIONS.md`/
  `TASKS.md`, ale samotnou implementaci (nový monitoring/rozhodování "co je dost
  relevantní") chce mít potvrzenou přímo od Lukáše v jeho chatu, ne přes relay —
  jde o novou autonomní automatizaci. **Čeká na uživatele** — buď napsat přímo
  zpravodajovi, nebo potvrdit tady a přepošlu.

## Odloženo (po výše uvedeném)

- **Infra-review agent** — občas projde systém a navrhne vylepšení, může reagovat
  na AI-novinky agenta/zpravodaje. Založit až jako druhý/třetí specialista, ne první.

## Hotovo

- **Delegace na jiné boty: viditelnost + odezva** (18.8.) — tři věci, co vyplynuly
  z toho, že po zadání zpravodajovi bylo 10 minut ticho v obou chatech: (1) do
  `personal/assistant/CLAUDE.md` přidána sekce "Delegace na jiné boty" — při
  `SendMessage` jinému botovi to řeknu uživateli hned, ne až po výsledku;
  (2) do `zpravodaj/CLAUDE.md` a `mailista/CLAUDE.md` přidána konvence: na
  cross-session zadání od assistenta vždy pošlou zpátky potvrzení/výsledek přes
  `SendMessage`, a nejasnosti si ujasňují zpátky s assistentem (ne rovnou s
  uživatelem) — výjimka je jen něco nevratného/destruktivního, kde se ptají
  přímo uživatele; (3) dashboard dostal sloupec "Právě dělá" (`personal/dashboard/
  src/processing.ts`, čte neprázdnost `job_queue_ts.json` — žádná nová
  instrumentace) s náhledem textu aktuálně zpracovávané zprávy. Dashboard
  restartován a ověřeno na běžícím serveru (`curl` ukazuje "⚙️ zpracovává" +
  náhled u assistant bota, zatímco zpracovává právě tuhle zprávu).
- **Git pro `agent-system`** (17.8., zjištěno jako hotové 18.8.) — repo existuje
  (initial commit `3e964bc`), `.gitignore` pokrývá `.env*`/logy/sqlite/`node_modules/`,
  napojeno na GitHub (`origin` → `laczker/My-Agents-System`).
- **Obsahové zadání zpravodaje a mailisty** — vyřešeno přímo s uživatelem v chatech
  jednotlivých botů.
- **Trvalý přístup do `personal/dashboard/` bez SSH tunelu** (18.8.) — vyřešeno
  Tailscale (viz `DECISIONS.md`), ne basic auth. Dashboard teď poslouchá na
  tailnet IP `100.108.179.97:8765`, dostupný z jakéhokoliv zařízení v uživatelově
  tailnetu bez terminálu/tunelu.
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

- **Agent na zakládání agentů** (Ludwigův `agentsmon new` vzor) — až budou existovat
  1-2 reální specialisté, na kterých se ustálí postup zakládání. Zatím zakládání dělá
  Claude přímo.
