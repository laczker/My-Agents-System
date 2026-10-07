# DevBot — úkoly

Stav ověřen proti kódu, compose souborům, `watchdog.sh` a `git log` k 7.10.2026
(iterace 6–11 hotové). Podrobnosti k hotovým věcem jsou v `DECISIONS.md`.

## Otevřené (podle priority)

1. **`~/.claude.json` je pořád single-file mount (inode)** — oba compose soubory
   mountují `/home/agent/.claude.json:ro` jako soubor; po přepsání na hostu
   (tmp+rename) kontejner vidí starý obsah. Řešení: adresářový mount /
   `CLAUDE_CONFIG_DIR`. Dotýká se auth. Velikost: M. Nasazení = recreate.
2. **Restart skripty / watchdog** — dávkování startu botů ve `watchdog.sh` (po
   zapnutí cronu nahodí všechny najednou = paměťová špička, možná příčina pádu
   1.10.); starý vzor `src/index\.ts$` pro `assistant` v
   `restart_remaining_profiles.sh` zasáhne i dashboard a webapp zpravodaje.
   Velikost: S.
3. **Adresářový mount pro `META_BOT.md`/`ARCHITEKTURA.md`** — dnes jen `:ro`
   single-file mount, kontejnerový assistant je nemůže upravovat. Přesun do
   adresáře + úprava odkazů v ~9 `CLAUDE.md`/`DECISIONS.md`. Velikost: M. **Hotovo (branch batchF-docs-mount, čeká na merge + recreate kontejnerů).**
4. **Rotace `chat_history.txt`** — `history.ts` čte celý soubor, na disku se
   netrimuje. Sdílený kód všech botů (nasazení restartuje všechny). Velikost: S–M.
5. **Drobnosti** — ověření SendMessage kontejner → kontejner (iterace 9);
   postup obnovy OAuth tokenu v dokumentaci (po iteraci 11 stačí `claude /login`
   na hostu); po každém worktree ověřit `git merge-base HEAD main`.
6. **Sebe-restart devbota může useknout vlastní odpověď** — čekat na zápis tahu
   do `chat_history.txt`, po restartu navázat. Potřeba spec. Velikost: M.
7. **Watchdog iterace B: "běží, ale auth nefunguje"** — process-level detekce
   OAuth výpadku. Creds v kontejneru jsou read-only, refresh dělá jen host.
   Velikost: M. Potřeba spec.
8. **Telegram UX, druhá vlna** — `reply_parameters`, `setMessageReaction`,
   `editMessageText`. Sdílený kód všech botů. Velikost: M.
9. **Přesun devbota do kontejneru** — nemůže restartovat sám sebe, pracuje nad
   repem + worktrees + docker socketem. Potřeba spec. Velikost: L.
10. **Sjednotit chování agentů / jazyk a frekvence mezikroků** — uživatel
    5.10. řekl "teď neřešit"; čeká na pokyn. Velikost: M–L.
11. **`unescapeDelimiter` a zero-width space** — nízká priorita, řešit až se
    změnou formátu na JSON-lines.
12. **Bezpečnost: `crontab_backup.txt` je v gitu a obsahuje plaintext
    `CLAUDE_CODE_OAUTH_TOKEN`** — gitignore / placeholder; vyžaduje schválení.
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
