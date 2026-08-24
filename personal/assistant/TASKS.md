# Úkoly — backlog

Průběžný seznam rozhodnutých/otevřených úkolů, aby se nemuselo spoléhat na
`chat_history.txt` (drží jen pár posledních výměn) ani na paměť v rámci jedné session.
Formát: stav, krátký popis, co blokuje. Hotové položky se mažou nebo přesouvají do
`DECISIONS.md`, pokud šlo o architektonické rozhodnutí.

## Čeká na uživatele

- **Mailista: bezpečnostní upozornění od Google, DVAKRÁT (vlákna `17cc11a8f965462b`
  a `17ff76b10dd667db`)** — 20.8. a 24.8., nalezeno při nočním čištění, obě
  `no-reply@accounts.google.com`, obě stejný text: "Kritické bezpečnostní
  upozornění" — někdo znal heslo k Lukášovu Google účtu a pokusil se přihlásit
  z **aplikace třetí strany**, Google pokus zablokoval. První 2021-10-27, druhé
  2022-04-05 — jiný měsíc, stejný vzorec ("aplikace třetí strany"), takže to může
  být opakovaně unikající/sdílené heslo, ne jednorázová náhoda. Na rozdíl od
  běžných "nové zařízení přihlášeno" hlášek (ty mailista bez váhání archivuje)
  tohle říká, že heslo bylo skutečně známé útočníkovi. Mailista obě vlákna
  záměrně nechala netknutá (ne archivováno/smazáno) a nechává na Lukášovi, ať
  zváží, jestli od té doby heslo změnil / nepoužívá ho jinde (případně jinde,
  kde stejné heslo použil). Nic není potřeba udělat hned.

- **Google/research agent (deep research)** — 19.8. potvrzeno: samostatný bot
  (ne ad-hoc subagent zde), dedikovaný na deep research, `--model opus`.
  Zjištěno dřív (18.8., subagent prohledal Ludwigův `Agent2Telegram`): žádný
  vlastní deep-research vzor tam není, research jde přes stejné nativní
  nástroje (`WebSearch`/`WebFetch`/subagent), co používá assistant; model per
  bot je čistě statický `--model` flag v configu. Uživatel chce k novému
  botovi přidat i nějaká pravidla/konvence, zatím neupřesnil jaká — **čeká se
  na uživatele**, ať řekne konkrétní pravidla (např. jak vybírat/ověřovat
  zdroje, kdy eskalovat/ptát se, formát výstupu), pak založit podle šablony
  v `META_BOT.md`.
## Rozpracováno

- **Přidělování modelů jednotlivým agentům/botům — mechanismus hotový** (19.8.) —
  `bridge-ts` teď čte `CLAUDE_MODEL` z `.env.<profil>` a posílá ho jako statický
  `--model` flag (default `sonnet`, žádná změna chování u žádného ze 3 běžících
  botů). Pravidlo pro volbu při zakládání dalšího bota je v `META_BOT.md` §2a.
  Commitnuto a boty restartované, ať je flag reálně aktivní. Otevřené zůstává jen
  konkrétní rozhodnutí u research agenta (opus, čeká na uživatele níž) — jinak nic
  neblokuje.
## Odloženo (po výše uvedeném)

- **Infra-review agent** — občas projde systém a navrhne vylepšení, může reagovat
  na AI-novinky agenta/zpravodaje. Založit až jako druhý/třetí specialista, ne první.
- **Programátor bot** (nápad 19.8.) — dedikovaný bot na vývoj/údržbu SW v tomhle
  systému (např. webovky jako u zpravodaje), který zná tech stack a konvence
  projektu (viz "web-stack-preference" v paměti: JS/TS, Node, React, bez Cypress).
  Důvod: včerejší webapp úkol nechaný na zpravodajovi (který k tomu není určený)
  vedl k OOM pádu; dedikovaný bot by měl nižší spotřebu tokenů (nemusí si dokola
  domýšlet kontext projektu) a jasnější odpovědnost.
- **Šablona/podsystém pro jednotlivé SW projekty** (nápad 19.8.) — obecná šablona,
  kterou by "programátor bot" (nebo budoucí meta-bot) použil při zakládání nového
  dílčího bota/podsystému na konkrétní SW projekt — souvisí s "Agent na zakládání
  agentů" níž, ale je užší (jen pro SW projekty, ne libovolný bot).
- **Finanční poradce bot** (nápad 19.8.) — zatím jen název nápadu, náplň/rozsah
  nedomluvený. Pozor: cokoliv s penězi je podle "Principy" nízká autonomie, bude
  vyžadovat explicitní schválení u konkrétních akcí, ne jen u založení.
- **Učitel angličtiny bot** (nápad 19.8.) — zatím jen název nápadu, náplň/rozsah
  nedomluvený.
- **Nákupní lístek** (nápad 24.8.) — zatím jen název nápadu, náplň/rozsah nedomluvený.
- **Kuchařka** (nápad 24.8.) — zatím jen název nápadu, náplň/rozsah nedomluvený.
- **Programátor bot na interní vývoj** (nápad 19.8., znovu zmíněn 24.8.) — dedikovaný
  bot na vývoj/údržbu SW v tomhle systému (např. web pro zpravodaje). Zůstává beze
  změny v "Odloženo" výš, žádný nový detail zatím nepřibyl.

## Hotovo

- **Bot na hledání pracovních nabídek — založen (`joby`, `@LukasuvHlidacJobuBot`)**
  (24.8.) — první nový specialista po assistant/zpravodaj/mailista. Profil a
  kritéria "dost zajímavé nabídky" domluvené s uživatelem (React/JS/TS vývojář
  ~1 rok, dřív automation engineer/Cypress ~2 roky a tester ~3 roky; hledá
  junior/medior frontend/fullstack pozice; plat je hlavní motivace, aktuálně
  65 000 Kč hrubého — hlásit jen nabídky viditelně nad tím, nebo bez uvedeného
  platu, pokud pozice/firma vypadá slibně; lokalita bez omezení; jednou denně,
  žádné "nic jsem nenašel" hlášení, jen shrnutí + odkaz, žádné akce navíc jako
  odesílání přihlášky). Zapsáno do `personal/joby/CLAUDE.md`. Infrastruktura
  založena podle šablony v `META_BOT.md` §2: `.env.joby` s tokenem, přidán do
  `watchdog.sh`, proces nastartován a běží. Bot si má na začátku první session
  sám nastavit vlastní denní `CronCreate` pro hledání (instrukce je v jeho
  `CLAUDE.md`) — nekontrolováno, jestli to už proběhlo. `META_BOT.md` diagram
  a přiřazení modelů aktualizováno na 4 boty. Necommitnuto (watchdog.sh,
  META_BOT.md, TASKS.md).
- **Zpravodaj: potlačit spam z opakovaných rate-limit hlášek** (24.8.) —
  `daily_digest.sh`/`ai_news_digest.sh` posílaly novou "⚠️ nepodařilo se
  sestavit" zprávu při KAŽDÉM dalším naplánovaném pokusu, i když šlo o jeden
  probíhající výpadek (doloženo: pá/so/ne 21.–23.8. tři skoro identické alerty
  za týž limit). Zpravodaj přidal marker soubor pro probíhající výpadek: první
  selhání pošle 1 varování a založí marker; dokud existuje (strop 48h denní /
  96h týdenní), cron zkouší automaticky znovu i mimo normální okno bez dalšího
  spamu (jen log); po úspěchu 1 recovery zpráva; po překročení stropu 1 zpráva
  o vzdání se. Otestováno end-to-end na kopiích skriptů s fake claude/curl/npx,
  zapsáno do zpravodajova `DECISIONS.md`, pushnuto na `main` (standing
  permission na `agent-system` repo).
- **Noční dojetí mailisty (noc 19.8.→20.8.)** — proběhlo, potvrzení funguje:
  9 dávek půlnoc–5:00, 701 vláken (501 smazáno jako marketing, 199 archivováno
  jako transakční/bezpečnostní/administrativa, 1 ponecháno stranou — Google
  security alert, viz položka výše v "Čeká na uživatele"). Pokryto od založení
  schránky po listopad 2021, pokračuje další noc od
  `is:unread in:inbox after:2021/09/01 before:2021/10/15`, stav v
  `personal/mailista/CLEANUP_PROGRESS.md`. Výsledek poslán Lukášovi přímo do
  mailistova Telegram chatu (podle konvence delegace), tady jen koordinační
  potvrzení. Recurring — mailista pokračuje sám další noci, nesleduje se tu
  dál jako otevřený úkol.
- **Nahrávání souborů/obrázků přes Telegram** (19.8.) — zjištěno: `bridge-ts` to
  už umí, funkčnost byla v systému od initial commitu (`bridge-ts/src/attachments.ts`
  + `index.ts`, zděděno z původního `bridge.py`). Dokument i foto se stáhnou do
  `personal/<bot>/inbox/` a do promptu se vloží `[PŘIPOJEN SOUBOR: <cesta>]` — proto
  má assistantovo `CLAUDE.md` instrukci "pokud uživatel přiložil soubor, zkontroluj
  jeho obsah v inboxu". Nic nebylo potřeba dodělávat, jen ověřit.
- **Mailista: 6 vláken od fakturace@endora.cz (prosinec 2020)** (19.8.) — rozhodnuto
  uživatelem archivovat (endoru nezná). Mailista archivoval — bylo jich 6, ne 4 jak
  původně odhadnuto, ale všechny stejná skupina/rozhodnutí.
- **Zpravodaj: webová stránka pro čtení digestů** (18.8., dokončeno zpravodajem
  21:5x) — server zapojen do `watchdog.sh` (bug: `pgrep` porovnával relativní
  cestu stejně jako proces, nikdy se nenašly → EADDRINUSE; oprava přes absolutní
  cestu, stejný vzor jako dashboard). `daily_digest.sh`/`ai_news_digest.sh` teď
  ukládají plný text přes `webapp/server/src/addDigest.ts` a do Telegramu posílají
  jen jednořádkové shrnutí + odkaz. Běží na `100.108.179.97:8766`. Kontextový
  spike z 20:17 UTC (co způsobil dřívější pád/OOM) se zpravodajovi nepodařilo
  zpětně vystopovat — pravděpodobně `node_modules`/webapp objem, ale jistota
  není. `webapp/` zatím není v gitu (čeká na pokyn, jestli commitnout).
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
