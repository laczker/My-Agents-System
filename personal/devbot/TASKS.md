# DevBot — úkoly

Stav ověřen proti kódu, compose souborům, `watchdog.sh` a `git log` k 7.10.2026
(iterace 6–11 hotové). Podrobnosti k hotovým věcem jsou v `DECISIONS.md`.

## Otevřené (podle priority)

1. **Iterace 11b: `trener` do dashboardu** — `personal/dashboard/src/config.ts`
   nemá `trener` vůbec (ověřeno: 0 výskytů), takže v dashboardu chybí heartbeat
   i restart tlačítko. Přidat s `inContainer: "daily-bots"`. Velikost: S. Restart
   dashboardu = potřeba schválit (dotčený běžící proces).
2. **`~/.claude.json` je pořád single-file mount (inode)** — oba compose soubory
   mountují `/home/agent/.claude.json:ro` jako soubor; po přepsání na hostu
   (tmp+rename) kontejner vidí starý obsah (projevilo se u Rohlík MCP schválení,
   nutný `--force-recreate`). Řešení: symlink/přesun do adresáře, nebo
   `CLAUDE_CONFIG_DIR`. Nutný spec (dotýká se auth). Velikost: M. Recreate
   kontejnerů = schválení restartu.
3. **`mem_limit`/restart limit pro `daily-bots`** — oba kontejnery mají
   `restart: "no"` a žádný `mem_limit` (ověřeno grepem); 6 botů v jednom
   kontejneru na ~3,7 GB hostu = OOM jednoho shodí všechny. Navrhnout limit +
   případně `deploy.resources`; restart řeší watchdog. Velikost: S. Recreate =
   schválení.
4. **Sirotčí kontejner `agent-system-project-bots-1`** — oba compose soubory
   sdílí project name `agent-system` (žádný `name:`), takže `compose up` jednoho
   souboru hlásí druhý jako orphan a `--remove-orphans` by ho SMAZAL. Oprava:
   `name:` v každém souboru (např. `agent-system-daily`/`-project`), ale to
   přejmenuje kontejnery = recreate obou. Velikost: S. VYŽADUJE schválení
   (zásah do běžících fbalbums + denních botů); nikdy `--remove-orphans`.
5. **Přesun devbota do kontejneru** — devbot jako jediný pořád na hostu (trener
   už v `daily-bots`). Problém: nemůže restartovat sám sebe a pracuje nad
   `agent-system` repem + worktrees + docker socketem. Potřeba spec (vlastní
   kontejner? Docker socket mount?, kdo ho restartuje). Velikost: L. Schválení
   specu i restartu.
6. **Sladit pin `claude` CLI v `Dockerfile.daily`/`Dockerfile.project`** —
   pin `2.1.280`, host má `2.1.291` (drift se opakuje). Bump vyžaduje rebuild +
   recreate. Zvážit build arg/jeden zdroj verze. Velikost: S. Recreate =
   schválení.
7. **Seznam kontejnerových profilů na 3 místech** — `DAILY_PROFILES` ve
   `watchdog.sh` (ř. 37), `start-daily.sh` default a `inContainer` v dashboard
   `config.ts` (viz 1). Jeden zdroj pravdy. Velikost: S–M. Restart dashboardu =
   schválení.
8. **Adresářový mount pro `META_BOT.md`/`ARCHITEKTURA.md`** — dnes jen `:ro`
   single-file mount, kontejnerový assistant je nemůže upravovat. Přesun do
   adresáře + úprava odkazů v ~9 `CLAUDE.md`/`DECISIONS.md`. Velikost: M. Bez
   restartu botů až po recreate kontejnerů.
9. **`META_BOT.md` nezachycuje iteraci 11** (`~/.claude` jako ro adresářový
   mount; zmíněna jen iterace 10) — doplnit spolu s dalším zásahem do dokumentu.
   Velikost: XS, bez restartu.
10. **`restart_devbot.sh` self-detach `$0`** — `setsid "$0"` pořád
    selže tiše, když je skript volán bez `/` (`bash restart_devbot.sh`);
    oprava `readlink -f "$0"`. Totéž ověřit u `restart_remaining_profiles.sh`.
    Velikost: XS. Nevyžaduje restart (jen skript).
11. **Restart skripty — další drobnosti** — `pgrep -f "src/index\.ts devbot"` je
    substring match na celý cmdline; `restart_remaining_profiles.sh` vypíná cron
    pro všech profilů najednou (ne per-profil) a hromadný restart 7 procesů je
    paměťová špička (možná příčina pádu devbota 1.10.). Dávkovat. Velikost: S.
    Schválení při ostrém testu.
12. **Sebe-restart devbota může useknout vlastní odpověď** — čekat na zápis tahu
    do `chat_history.txt` místo pevného zpoždění; po restartu navázat a aktivně
    oznámit. Související: po restartu devbot nenavazuje na rozdělanou práci.
    Potřeba spec. Velikost: M.
13. **Sjednotit chování agentů / jazyk a frekvence mezikroků** — recidiva
    anglických a samostatných mezikroků i po `firstBlockSeen` fixu (5.10.).
    Audit `CLAUDE.md` profilů proběhl/zadán 1.10.; výstup má být šablona pro
    zakládání nových botů. Uživatel 5.10. řekl "teď neřešit" — čeká na pokyn.
    Velikost: M–L.
14. **Watchdog iterace B: "běží, ale auth nefunguje"** — process-level detekce
    OAuth výpadku (EOF bez `result` eventu textová detekce nezachytí). Pozor:
    po iteraci 11 jsou creds v kontejneru read-only, takže refresh dělá jen
    host. Velikost: M.
15. **Telegram UX, druhá vlna** — `reply_parameters`, `setMessageReaction`,
    živá editace (`editMessageText`). Typing + Markdown hotovo. Velikost: M,
    sdílený kód všech botů.
16. **Rotace `chat_history.txt`** — `history.ts` čte celý soubor, na disku se
    netrimuje (zápisy zrychlené unsolicited tahy). Velikost: S–M, sdílený kód
    (restart všech botů).
17. **Ověření SendMessage host → kontejner (iterace 9)** — doručení k `nakup-ec`
    drženo kvůli permission módu druhé strany; registr + sokety fungují.
    Zbývá kontejner → kontejner. Velikost: XS.
18. **`unescapeDelimiter` a zero-width space** — okrajový případ; řešit až
    případnou změnou formátu na JSON-lines. Nízká priorita.
19. **Proces: `EnterWorktree` větví z `origin/main`** (pozadu za lokálním `main`)
    — po každém worktree ověřit `git merge-base HEAD main` a rebasovat.
    Případně pushnout `origin`. Velikost: XS.
20. **Obnova OAuth tokenu — postup** — po iteraci 11 stačí `claude /login` na
    hostu (adresářový mount vidí nový soubor), `compose restart` by neměl být
    nutný; ověřit při příštím vypršení a upravit postup v dokumentaci.
21. **Připomínka: ověřit/obnovit `CLAUDE_CODE_OAUTH_TOKEN` kolem 15.9.2027**
    (setup-token, ~1 rok, nelze hlídat souborově).

## Hotové (jeden řádek na položku)

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
