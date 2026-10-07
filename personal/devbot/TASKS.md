# DevBot — úkoly

Stav ověřen proti kódu, compose souborům, `watchdog.sh` a `git log` k 7.10.2026
(iterace 6–11 hotové). Podrobnosti k hotovým věcem jsou v `DECISIONS.md`.

## Otevřené (podle priority)

1. **`~/.claude.json` single-file mount (inode)** — vyřešeno jen jako ruční `--force-recreate` po změně na hostu. Adresářový mount ani `CLAUDE_CONFIG_DIR` nejdou (`.env` a klíče v `$HOME`, rozbité resume session); větev batchD-claude-json zamítnuta.
2. **Restart skripty / watchdog** — hotovo (`57ad2e2`). Volitelně: postupný start profilů uvnitř `start-daily.sh` (vyžaduje rebuild image).
3. **Adresářový mount pro `META_BOT.md`/`ARCHITEKTURA.md`** — dnes jen `:ro`
   single-file mount, kontejnerový assistant je nemůže upravovat. Přesun do
   adresáře + úprava odkazů v ~9 `CLAUDE.md`/`DECISIONS.md`. Velikost: M. **Hotovo (`708fed0`, nasazeno).**
4. **Rotace `chat_history.txt`** — `history.ts` čte celý soubor, na disku se
   netrimuje. Sdílený kód všech botů (nasazení restartuje všechny). Velikost: S–M. **Hotovo (merge `9f54281`, nasazeno).**
5. **Drobnosti** — ověření SendMessage kontejner → kontejner (iterace 9):
   **částečně ověřeno 7.10.** read-only (viz `META_BOT.md`, iterace 9): oba
   kontejnery vidí identický registr `sessions` i `cc-socks` a živé PID hostu;
   holé `connect()` na sokety funguje daily → project, project → daily i
   kontejner → host (devbot). **Neověřeno:** skutečné doručení zprávy (nesmí se
   posílat do botích chatů) a zda `SendMessage` akceptuje rozdílný `pidDomain`
   (host `linux:<machine-id>:pid:[ns]` vs. kontejnery `linux::pid:[ns]`, v
   kontejneru chybí `/etc/machine-id`). **Ověřeno 7.10. živě:** `SendMessage`
   z `joby` (kontejner `daily-bots`) na devbota (host) doručen, rozdílný `pidDomain`
   nevadí; směr host → kontejner fungoval také. **Hotovo 7.10.:** postup obnovy OAuth tokenu zdokumentován v `META_BOT.md`
   (`claude /login` na hostu, rotace `setup-token` v crontabu); po každém worktree ověřit `git merge-base HEAD main`.
6. **Sebe-restart devbota může useknout vlastní odpověď** — čekat na zápis tahu
   do `chat_history.txt`, po restartu navázat. Velikost: M.
   **Hotovo:** `restart_devbot.sh` čeká na prázdnou frontu + outbox + nepřítomnost
   `busy_ts.txt` (`bridge-ts/src/busy.ts`), timeout 600 s, viz `DECISIONS.md` a `META_BOT.md`.
7. **Watchdog iterace B: "běží, ale auth nefunguje"** — process-level detekce
   OAuth výpadku. Creds v kontejneru jsou read-only, refresh dělá jen host.
   Velikost: M. **Hotovo (iterace 13, `auth_watch.sh`, viz `META_BOT.md`).**
8. **Telegram UX, druhá vlna** — `reply_parameters`, `setMessageReaction`,
   `editMessageText`. Sdílený kód všech botů. Velikost: M. **Hotovo (reply + reakce 👀 v `main`, commit 2025053; `editMessageText` zamítnut, viz `DECISIONS.md`).**
9. **Přesun devbota do kontejneru** — **zamítnuto 7.10.** Devbot musí zůstat na
   hostu s plným přístupem (nezávislá pojistka při problémech kontejnerů/cronu);
   alternativy (docker socket, žádosti přes soubor) jsou buď bezpečnostní riziko,
   nebo omezení. Viz `DECISIONS.md`. Sebe-restart řeší č. 6.
10. ~~**Sjednotit chování agentů / jazyk a frekvence mezikroků**~~ — HOTOVO: bridge-ts už posílá jen první a poslední blok unsolicited tahu (+ `[TICHO]`); `check_bot_conventions.sh` ověřuje, že každý `personal/*/CLAUDE.md` má sekci `## Jazyk` a pravidlo `[TICHO]`; assistantovi chybělo `[TICHO]`, doplněno. Bez změny kódu bridge-ts.
11. ~~**`unescapeDelimiter` a zero-width space**~~ — HOTOVO: escape je teď
    bijektivní (přidá/odebere jedno ZWSP před `\n`), takže původní ZWSP v textu
    přežije round-trip; změna formátu na JSON-lines nebyla potřeba.
12. **Bezpečnost: `crontab_backup.txt`** — hotovo: vyřazen z gitu a v `.gitignore`
    (skripty ho generují z `crontab -l`). Token zůstává v historii prvního commitu;
    repo na GitHubu je soukromé (potvrzeno 7.10.). **TODO uživatel (později):** token
    rotovat (`claude setup-token`) a nový vložit do crontabu, `.env` a kontejnerů.
13. **Připomínka: ověřit/obnovit `CLAUDE_CODE_OAUTH_TOKEN` kolem 15.9.2027.**

## Hotové (jeden řádek na položku)

- Iterace 12 (7.10., `8e4952e`): `mem_limit` (daily 1536m, project 512m), pevné `name:`/`container_name` v compose (konec sirotčího kontejneru), jeden `ARG` verze `claude` CLI (2.1.291), `trener` v dashboardu, `daily-profiles.txt` jako jediný zdroj seznamu profilů, `readlink -f "$0"` a kotvy `pgrep` v restart skriptech, `META_BOT.md` doplněn o iteraci 11.
- Docker pilot iterace 1–5: Dockerfile + compose pro denní skupinu, mounty, watchdog `docker compose` hlídání (neaktivní), Dockerfile + compose pro projektovou skupinu (fbalbums).
- Iterace 3: `META_BOT.md`/`ARCHITEKTURA.md` do kontejneru jen `:ro` (inode; strukturální oprava zůstává otevřená, viz 8).
- Iterace 6 (5.10.): canary cutover `nakup`; opraven kritický bug chybějící `procps` v `Dockerfile.daily` (watchdog každou minutu force-recreate).
- Iterace 7 (7.10.): cutover `assistant` do `daily-bots`.
- Iterace 8 (6.10.): cutover zpravodaj/mailista/joby do `daily-bots`, fbalbums do `project-bots`, watchdog + dashboard přepnuté (bez `/code-review`).
- Iterace 9 (6.10.): sdílený registr session (`pid: host`, mounty `sessions` + `cc-socks`); směr kontejner → host ověřen.
- Iterace 10 (6.10.): `trener` z hostu do `daily-bots` (6 denních botů); poučení: `start-daily.sh` je COPY v image, změna chce `--build --force-recreate`.
- Iterace 11 (7.10.): `~/.claude` mountovaný jako read-only adresář (stale credentials inode, 401 po refreshi tokenu); řeší dřívější položku "Obnova OAuth tokenu".
- Rohlík MCP pro `nakup` (6.10.): `.mcp.json`, schválení a OAuth na hostu, `claude mcp list` v kontejneru Connected.
- Claude CLI pin bump 2.1.233 → 2.1.280 v `Dockerfile.daily`/`Dockerfile.project` (opět zastaralé, viz 6).
- Úklid komentářů v kódu (30.9.): čeština pryč, bez AI balastu (`worktree-cleanup-comments`).
- `handleUnsolicitedLine`: živě jen první a finální blok tahu (`firstBlockSeen`, 1.10.); recidiva mezikroků viz 13.
- Restart skripty: self-kill `restart_devbot.sh` (incident 1.–3.10., ~40 h bez devbota a watchdogu) opraven přes `setsid` re-exec, `trap EXIT`, `send_alert` (5.10.).
- Restart skripty: už nestartují nový proces samy (2× OAuth výpadek 5.10. z dědění env), start nechán na cron `watchdog.sh`, ověřeno na živém devbotovi.
- Pád devbota 1.10. při hromadném restartu (pravděpodobně OOM) — jednorázový, chytil cron; prevence viz 11.
- Zápis unsolicited textu do `chat_history.txt` + escapování `---` delimiteru (viz `DECISIONS.md`).
- Telegram UX první vlna (17.9.): typing indikátor, `parse_mode: Markdown` s fallbackem, odstraněna textová "Zpracovávám" hláška.
- OAuth iterace A: aktivní upozornění při `auth_error` místo tichého doručení; rate-limit timeout fallback v `bridge-ts`.
- `outbox.ts` zahazuje trvale nedoručitelné zprávy (400/403) místo blokace fronty.
- Cron `watchdog.sh` vypnutý při ručním restartu → 409 Conflict (30.9.): konvence zapsaná v `DECISIONS.md`.

- [x] Per-bot `cron.txt` (iter. 14, `run_bot_crons.sh`) — bots schedule durable jobs without the system crontab. Open: optional hash allowlist if the host-code-execution risk (container bot -> host script) should be gated.
- [x] Busy marker `busy_ts.txt` in bridge-ts (also for unsolicited/cross-session turns) + `restart_devbot.sh` waits for it (branch `busy-marker`).

## Přesunuto z `personal/assistant/TASKS.md` (7.10.2026, infrastrukturní záznamy)

Historické/rozpracované infra položky (zakládání botů, dashboard, bridge-ts, odložené infra nápady). Text beze změny.

- **`ListAgents`/`SendMessage` cross-bot discovery nespolehlivé — zachytí jen úzké
  okno, ne "proces běží"** (6.10.) — opakovaně ověřeno: `ListAgents` z assistant
  session vrací "No reachable agents" i když nakup a ostatní denní boti prokazatelně
  běží a odpovídají na Telegramu; `SendMessage` na jméno `devbot` selže stejně.
  Dotaz na mechanismus/spolehlivější cestu poslán devbotovi spolu s úkolem výše —
  ale doručení samo narazilo na přesně tenhle problém, takže otázka čeká na
  příležitost, kdy bude devbot zachytitelný (nebo až se sám ozve).
- **Přidělování modelů jednotlivým agentům/botům — mechanismus hotový** (19.8.) —
  `bridge-ts` teď čte `CLAUDE_MODEL` z `.env.<profil>` a posílá ho jako statický
  `--model` flag (default `sonnet`, žádná změna chování u žádného ze 3 běžících
  botů). Pravidlo pro volbu při zakládání dalšího bota je v `META_BOT.md` §2a.
  Commitnuto a boty restartované, ať je flag reálně aktivní.
- **Infra-review agent** — občas projde systém a navrhne vylepšení, může reagovat
  na AI-novinky agenta/zpravodaje. Založit až jako druhý/třetí specialista, ne první.
- **Šablona/podsystém pro jednotlivé SW projekty** (nápad 19.8.) — obecná šablona,
  kterou by "programátor bot" (nebo budoucí meta-bot) použil při zakládání nového
  dílčího bota/podsystému na konkrétní SW projekt — souvisí s "Agent na zakládání
  agentů" níž, ale je užší (jen pro SW projekty, ne libovolný bot).
- **Trenér — bot na kalorie/sport založen a běží** (22.9.) — nový specialista po
  devbot: uživatel roky neúspěšně zkouší zhubnout, chce logovat jídlo (foto nebo
  psaný popis, foto jen orientační odhad ±30–40 %, uživateli to nevadí, dřív
  používal podobnou appku) a sport (zatím ručně, napojení na Strava zvažováno
  jako budoucí rozšíření, ne MVP) a časem pomoct s progresem v běhu/lezení.
  Ukládání zatím jako jednoduchý JSON log per den, žádná DB (vzor `nakup`).
  Založeno podle šablony `META_BOT.md` §2: `personal/trener/` (`CLAUDE.md`,
  `DECISIONS.md`, `TASKS.md`, `inbox/`), token v `.env.trener`
  (`@LukasuvTrenerBot`), přidán do `watchdog.sh`, proces nastartován a ověřen
  (startovací zpráva odeslána, polling běží). `META_BOT.md` aktualizován na
  8 botů (diagram, watchdog výčet, sonnet přiřazení). Od teď obsahové zadání
  (formát logování, tón u diet/fitness témat — vždy podpůrný, ne kárající,
  viz uživatelova dlouhá historie neúspěšných pokusů) patří do jeho vlastního
  Telegram chatu, ne sem.
- **DevBot — založen a běží** (7.9.) — uživatel se rozhodl řešit dockerizaci
  (a budoucí interní infra práci obecně) přes dedikovaného vývojového bota místo
  přímo v assistant chatu, stejně jako `fbalbums`. Na rozdíl od `fbalbums` (kód
  produktu mimo `agent-system`, viz `META_BOT.md` §2) `devbot` pracuje přímo nad
  `agent-system` repem samotným — worktree izolace se otvírá nad ním, ne nad
  odděleným repem, protože `agent-system` JE ten produkt, který udržuje. Bot
  založen podle `META_BOT.md` šablony: `personal/devbot/CLAUDE.md` (role +
  stejný vývojový cyklus analytik→vývojář→reviewer→checkpoint jako `fbalbums`,
  navíc nízká autonomie pro zásah do běžícího procesu jiného bota/crontabu kvůli
  sdílenému produkčnímu provozu), token v `.env.devbot`, zápis do `watchdog.sh`,
  `META_BOT.md` aktualizován na 7 botů. První zadání: docker pilot (2 kontejnery
  podle rizikového profilu, denní vs. projektoví boti — spec a zdůvodnění viz
  položka výše v "Rozpracováno"). Incident při zakládání: ruční `nohup`/
  `run_in_background` start procesu nepřežil konec zakládací session (sandbox
  zabije celou skupinu procesů) — zdokumentováno do `META_BOT.md` §2 jako
  poučení pro příště, watchdog cron (`* * * * *`) proces sám nahodil do minuty a
  od teď ho drží naživu stejným mechanismem jako ostatních 6 botů. Heartbeat
  ověřen čerstvý. Od teď další vývoj/rozhodování o docker pilotu i budoucí infra
  úkoly patří do jeho vlastního Telegram chatu, ne sem.
- **AI Studio → první produkt FB Albums — bot založen a běží** (25.8.–4.9.) —
  uživatel poslal vlastní vizi (`AI_STUDIO_VIZE.md`), po diskusi ujasněno: nechce
  vyvíjet v assistant chatu ani ručně na vlastním PC, chce dedikovaného bota, co
  vyvíjí **autonomně** (role analytik→vývojář→reviewer jako krátkodobí subagenti
  na iteraci, git worktree izolace, dvě schvalovací brány — spec před kódem,
  konsolidovaný checkpoint spec+diff+review před mergem), s ovládáním/review z
  mobilu přes vlastní Telegram chat (paměti "assistant-not-for-product-dev-work",
  "user-as-code-reviewer-and-approver", "product-dev-bot-multi-role-iteration-
  template"). Deep research na best practices + tech stack uložen do
  `AI_DEV_WORKFLOW_TEMPLATE.md` (stack: Python dávková pipeline parsing/EXIF/
  dedup/náhledy → SQLite → Node/TS+React, self-hosted Tailscale). Zadání produktu:
  **jedna konverzace = jedno album**, konverzace se nemíchají, zprávy/text se do
  alba zatím vůbec nepromítají (jen fotky). Bot založen podle `META_BOT.md`
  šablony: `personal/fbalbums/CLAUDE.md` (zadání + vývojový cyklus), token v
  `.env.fbalbums`, zápis do `watchdog.sh`, `META_BOT.md` aktualizován na 6 botů
  (+ nová výjimka v §2: kód produktu žije mimo `agent-system`, v odděleném
  lokálním repu `/home/agent/fbalbums`, zatím bez remote). Proces nastartován a
  ověřen (heartbeat čerstvý, napojení na Telegram úspěšné), commitnuto a
  pushnuto (`8975986`). Od teď veškerý další vývoj/rozhodování o FB Albums patří
  do jeho vlastního Telegram chatu, ne sem — jediné co ještě chybí, je nahrání
  FB exportu fotek na Google Drive uživatelem, což řeší přímo s botem.
- **Joby: denní hledání přepnuto z `CronCreate` na crontab+skript** (24.–25.8.)
  — potvrzená nekonzistence napříč boty: joby si denní hledání původně
  naplánoval přes `CronCreate` (session-scoped, žije jen v paměti běžícího
  `bridge-ts` procesu), zatímco zpravodaj má stejný typ úlohy přes durable
  systémový `crontab` + samostatný skript. Po restartu joby procesu (watchdog)
  se naplánovaný `CronCreate` ztratil beze stopy, druhý den nepřišlo nic.
  Oprava zdroje problému: `META_BOT.md` §3.5 (nové pravidlo: trvalé opakované
  úlohy jen přes crontab+skript, nikdy jen `CronCreate`) a
  `personal/joby/CLAUDE.md` (chybná instrukce opravena). Joby si sám ve vlastním
  chatu navrhl `daily_job_search.sh` (DST-safe 8:00 pražského času, dedup přes
  `reported_jobs.txt`, outage marker po vzoru zpravodaje) + řádek v systémovém
  crontabu, uživatel schválil ("ano"), založeno a ověřeno: dnešní ranní běh
  (25.8. 8:34) proběhl úspěšně, nahlásil nabídky přímo do joby Telegram chatu.
- **Nákupní lístek — založen jako samostatný bot** (24.8.) — nejdřív se zkusilo
  vést seznam přímo v assistentovi (bez zakládání bota, bez čekání na
  partnerčino chat ID), ale uživatel se pak rozhodl chtít to přece jen jako
  samostatného bota. Založen `personal/nakup` podle šablony `META_BOT.md` §2:
  `@LukasuvNakupBot`, token v `.env.nakup`, přidán do `watchdog.sh`, proces
  nastartován a běží. `shopping_list.json` přenesen beze změny formátu
  (`{name, added_at}`, žádná DB, žádný stav "koupeno"). Pravidla přesunuta z
  `personal/assistant/CLAUDE.md` do `personal/nakup/CLAUDE.md`. Zatím jen
  Lukášův chat — rozšíření na partnerku přes `TELEGRAM_CHAT_IDS_EXTRA` v
  `.env.nakup` zůstává hotové, ale nepoužité, čeká na její Telegram chat ID.
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
  a přiřazení modelů aktualizováno na 4 boty. Commitnuto a pushnuto (`1b57148`).
- **Nahrávání souborů/obrázků přes Telegram** (19.8.) — zjištěno: `bridge-ts` to
  už umí, funkčnost byla v systému od initial commitu (`bridge-ts/src/attachments.ts`
  + `index.ts`, zděděno z původního `bridge.py`). Dokument i foto se stáhnou do
  `personal/<bot>/inbox/` a do promptu se vloží `[PŘIPOJEN SOUBOR: <cesta>]` — proto
  má assistantovo `CLAUDE.md` instrukci "pokud uživatel přiložil soubor, zkontroluj
  jeho obsah v inboxu". Nic nebylo potřeba dodělávat, jen ověřit.
- **Git pro `agent-system`** (17.8., zjištěno jako hotové 18.8.) — repo existuje
  (initial commit `3e964bc`), `.gitignore` pokrývá `.env*`/logy/sqlite/`node_modules/`,
  napojeno na GitHub (`origin` → `laczker/My-Agents-System`).
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
- **Agent na zakládání agentů** (Ludwigův `agentsmon new` vzor) — až budou existovat
  1-2 reální specialisté, na kterých se ustálí postup zakládání. Zatím zakládání dělá
  Claude přímo.
