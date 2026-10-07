# DevBot — architektonická rozhodnutí

## Telegram UX: `parse_mode: "Markdown"` (legacy V1), ne `MarkdownV2`

**Decision:** `sendRaw` posílá chunky s `parse_mode: "Markdown"` (legacy
styl: `*bold*`, `_italic_`, `` `code` ``). Při chybě parsování entit
(`GrammyError`, `error_code` 400, popis obsahuje "can't parse entities") se
stejný chunk pošle znovu bez `parse_mode` (syrový text, dnešní chování) —
teprve jiná chyba probublá dál k `outbox`.

**Why:** `MarkdownV2` vyžaduje escapovat širokou sadu běžných interpunkčních
znaků (`_*[]()~\`>#+-=|{}.!`) v celém textu mimo entity — Claude generuje
běžnou prózu/markdown, ne MarkdownV2-safe text, takže by prakticky každá
zpráva s tečkou, závorkou nebo pomlčkou skončila na 400 a spadla do
fallbacku (formátování by se ztrácelo skoro pořád, funkce by byla
bezúčelná). Legacy `Markdown` netoleruje jen nepárové/rozjeté entity
(`*`, `_`, `` ` ``, `[`), což je řádově vzácnější. Vedlejší efekt: Claude
běžně píše `**tučně**` (dvojhvězdička, standardní markdown), legacy mód
bere jen jednu hvězdičku jako přepínač — dvojice hvězdiček se spáruje do
dvou prázdných tučných úseků bez viditelného formátování, ale bez chyby
parsování (sudý počet, korektně uzavřené). Ztráta tučného řezu je přijatelná
kosmetická vada teď; převod `**` → `*` je out of scope (druhá vlna).

**Alternatives:**
- `MarkdownV2` — zamítnuto, viz výš (masivní fallback rate).
- Žádný `parse_mode`, jen HTML sanitizace `<b>`/`<i>` generovaná z markdownu —
  zvažováno, ale znamená psát vlastní markdown→HTML převodník; mimo rozsah
  týhle iterace (jen `parse_mode` + fallback).

**Date:** 2026-09-17

## `outbox.ts` zahazuje trvale nedoručitelné zprávy (400/403) místo blokace celé fronty

**Decision:** `flush()` v catch bloku rozlišuje `GrammyError` s `error_code` 400
nebo 403 (trvalá chyba) od všeho ostatního (dočasná chyba — síť, 5xx, 429).
Trvalá chyba: zaloguje se, položka se zahodí (`shift`+`persist`), smyčka
pokračuje na další položku ve frontě. Dočasná chyba: beze změny — `return`,
další pokus až za `OUTBOX_RETRY_INTERVAL_MS`.

**Why:** Incident nahlášený `nakup` — jedna trvale nedoručitelná zpráva (400
"chat not found") zastavila `flush()` `return`em bez ohledu na typ chyby,
takže se zablokovalo doručování VŠEM chatům/zprávám za ní ve frontě na 3
týdny (log narostl na 145 MB). 400 typicky značí chybu vázanou na
konkrétní zprávu/chat (i "message too long", špatný Markdown) — retry by
dopadl stejně, zahození dává smysl obecně, ne jen pro tenhle incident. 403
(bot zablokovaný v chatu) je trvalé pro celý chat, ne jen zprávu — bude
zahazovat i každou další zprávu do stejného chatu potichu, ne blokovat
frontu; přijatelné (fronta funguje pro ostatní chaty), ale znamená tiché
mizení zpráv do zablokovaného chatu bez alertu.

**Alternatives:**
- Zahazovat po N opakovaných neúspěších bez ohledu na kód chyby — zamítnuto,
  nerozlišuje trvalé od dočasných, u dočasné chyby (výpadek sítě) by mohlo
  zahodit zprávu, co by při dalším pokusu prošla.
- Alertovat uživatele při 403 (zablokovaný chat) místo tichého zahození —
  zvažováno, ale mimo schválený rozsah týhle iterace; případná budoucí
  iterace.

**Date:** 2026-09-17

## Fallback větev `runClaude` respektuje `isError`, aktivní upozornění při OAuth výpadku (iterace A)

**Decision:** `RunClaudeOutcome` rozšířen o `"auth_error"` a `"error"` stav vedle
`"ok"`/`"rate_limited"`. Fallback větev (po restart+retry) teď kontroluje `isError`
stejně jako hlavní větev — dřív ho ignorovala a vracela chybový text jako `"ok"`
výsledek. Rozpoznaný OAuth vzor (`/oauth/i` + `/expired|authenticat/i` v textu)
jde jako `auth_error` broadcastem všem chatům (stejně jako rate limit — netýká se
jen tazatele, dokud auth nefunguje, neodpoví na nic). Ostatní chyby po fallbacku
jdou jako `error` jen tazateli s `⚠️` prefixem.

**Why:** Incident 14.9. — `"OAuth session expired and could not be refreshed"` se
poslalo uživateli jako běžný `✅ Výsledek`, protože fallback větev nekontrolovala
`isError`. Detekce přes text, ne strukturovaný signál (na rozdíl od rate limitu,
kde `claude` CLI posílá `rate_limit_event`) — auth chyba žádný takový event nemá.

**Alternatives:**
- Nechat obecné chyby (non-OAuth) dál jako `"ok"` s `⚠️` prefixem (původní vzor
  z catch větve) — zamítnuto, matoucí kombinace `✅ Výsledek` + `⚠️` text; nový
  `"error"` kind je jasnější, `index.ts` ho zobrazí bez `✅`.
- Krátkodobě detekovat OAuth vzor už v hlavní (první) větvi a přeskočit
  restart+retry úplně — zamítnuto, restart je levný a jindy skutečně pomůže
  (např. dočasná chyba spojení), netřeba měnit dnešní strukturu tam, kde bug
  není.

**Date:** 2026-09-17

## Mount META_BOT.md/ARCHITEKTURA.md do denního kontejneru jen read-only (iterace 3)

**Decision:** `docker-compose.daily.yml` mountuje `META_BOT.md` a `ARCHITEKTURA.md`
z kořene repa do denního kontejneru jako `:ro` (read-only), ne `:rw`, jak byl
původní záměr specu iterace 3.

**Why:** Spec počítal s read-write mountem, protože `personal/assistant/CLAUDE.md`
ukládá assistentovi tyhle dokumenty při architektonických změnách i zapisovat.
Code review + přímé ověření (test inode před/po zápisu nástrojem `Edit`)
ale ukázaly, že rw mount jednotlivého souboru nesplní účel: `Edit` nepíše
in-place, ale přes tmp-soubor+rename, takže výsledek skončí na novém inode,
který bind mount jednotlivého souboru (vázaný na inode zachycený při startu
kontejneru, ne na cestu) vůbec nevidí — zápis by se tiše ztratil, nepropsal
by se na host. Read-write mount by tak vytvořil falešný pocit, že zápis
funguje, zatímco by tiše mizel.

**Alternatives:**
- Ponechat rw mount beze změny — zamítnuto, prokazatelně nefunkční pro hlavní
  účel (in-container editace), riziko tichého mizení dat.
- Přesunout oba soubory do vlastního adresáře a mountovat ten adresář celý
  (adresářové mounty přežijí i rename) — technicky správné řešení problému,
  ale zasahuje `bridge-ts/src` referencí (ověřeno gremem: 0, viz TASKS.md) a
  9 dalších `CLAUDE.md`/`DECISIONS.md` napříč boty, co soubory odkazují
  jménem — moc velký zásah na opravu uvnitř už schválené malé iterace.
  Odloženo jako samostatná budoucí iterace, viz `TASKS.md`.
- Mount celého kořene repa read-write — zamítnuto, zbytečně velký blast
  radius (celý zdrojový kód, ne jen 2 dokumenty) za cenu vyřešení stejného
  problému, co menší adresářový mount vyřeší bezpečněji.

**Date:** 2026-09-15

## Kolize `---` delimiteru v `chat_history.txt`: escapovat při zápisu, ne měnit formát (iterace "zápis unsolicited textu do historie")

**Decision:** `appendHistory` (`bridge-ts/src/history.ts`) escapuje literální
`"---\n"` uvnitř zapisovaného textu vložením neviditelného zero-width space
hned za trojici pomlček (`"---​\n"`), místo aby se měnil samotný
formát/delimiter souboru.

**Why:** Review 2. kola u týhle iterace našel, že `getHistory`/`appendHistory`
dělí výměny přes doslovný `"---\n"`, a nová zápisová cesta z
`handleUnsolicitedLine` typicky zapisuje Markdown-formátovaný text
(specy/checkpointy s horizontálními linkami), takže kolize je prakticky
pravděpodobnější než u běžných Telegram odpovědí — reprodukováno přímo (viz
`TASKS.md`, teď smazaná položka "Odloženo"). Escapování při zápisu opravu
izoluje na `appendHistory` bez dotčení `getHistory` ani formátu souboru na
disku — žádná migrace zpětné kompatibility, žádný dopad na existující obsah
`chat_history.txt` napříč 7 profily. Zero-width space je vizuálně neviditelný,
takže se text v Telegramu ani při zpětném čtení historie nezmění.

**Alternatives:**
- Změnit delimiter na kolizi-odolnější řetězec (např. vlastní marker) —
  zamítnuto pro tuhle iteraci: je to změna formátu souboru sdílená napříč
  `history.ts` a všemi 7 profily, vyžadovala by řešit zpětnou kompatibilitu
  se stávajícím obsahem `chat_history.txt` — moc velký zásah na review-fix
  uvnitř už schválené malé iterace.
- Neřešit teď, nechat jako odloženou položku (původní návrh z review) —
  zamítnuto po rozhodnutí uživatele opravit nález před mergem: jde o tichou
  ztrátu/zkomolení kontextu, stejná třída incidentu jako hlavní problém týhle
  iterace, ne jen kosmetika.

**Date:** 2026-09-21

## `appendHistory` si guarduje vlastní I/O interně, ne přes try/catch u volajícího (iterace "zápis unsolicited textu do historie", 3. kolo review)

**Decision:** `appendHistory` (`bridge-ts/src/history.ts`) obalí `appendFileSync`
vlastním try/catch a chybu jen zaloguje, stejnou konvencí jako `logTurn`
(`turnLog.ts`) — místo aby guard proti selhání zápisu (ENOSPC/EACCES) musel
duplikovat každý volající zvlášť.

**Why:** Druhé kolo review přidalo try/catch jen kolem nového volání v
`claudeProcess.ts` (unsolicited větev), ale ponechalo starší volání v
`index.ts` (běžná Telegram odpověď) neošetřené — při selhání zápisu by
výjimka utekla z `processQueue()` jako unhandled rejection a uživatel by
nedostal `✅ Výsledek`, i když úkol doběhl. Guard uvnitř `appendHistory`
pokryje oba volající najednou a nejde znovu zapomenout u budoucího třetího.

Zároveň v tomhle kole opraveno: `obj.type === "result"` větev v
`handleUnsolicitedLine` při ne-stringovém `obj.result` (pozorováno v praxi)
dřív zahodila text bez zápisu do historie, i když poslední streamovaný
`assistant` blok (`this.unsolicitedText`) byl k dispozici jako fallback —
reprodukovalo by to přesně ten incident, co iterace řeší. Historie teď padá
na `this.unsolicitedText`, broadcast (kde by šlo o duplicitní odeslání už
live odeslaného textu) zůstává beze změny na původním `obj.result`.

**Alternatives:**
- Nechat try/catch jen u nového volání, `index.ts:143` doplnit zvlášť —
  zamítnuto, řeší jen symptom, ne konvenci; příští volající by na to mohl
  zapomenout znovu.

**Date:** 2026-09-30

## Restart přes `watchdog.sh` konvenci musí nejdřív dočasně vypnout cron watchdog (incident 30.9.)

**Decision:** Jakýkoliv ruční restart `bridge-ts` procesu (kill + nový `nohup`)
musí napřed dočasně vyřadit `watchdog.sh` z crontabu (stejně jako to už dělá
`restart_bridge_ts.sh` — `crontab -l | grep -v watchdog.sh | crontab -`,
restartovat, pak crontab vrátit), a to i pro skript spuštěný na pozadí se
zpožděním (viz níž).

**Why:** Po mergi úklidu komentářů (30.9.) jsem restartoval 7 profilů (bez
devbota) ručním kill+nohup bez vypnutí cronu. `watchdog.sh` běží v cronu
každou minutu a kontroluje jen "běží/neběží" — v okně mezi mým kill a mým
nohup startem cron u několika profilů taky uviděl "neběží" a nastartoval
vlastní kopii, takže krátce běžely dva procesy se stejným Telegram tokenem
najednou → Telegram vrací `409 Conflict` oběma pollerům. Trvalo to u
jednotlivých profilů řádově desítky sekund až ~2 minuty (viz `409 Conflict`
řádky v `bridge_ts*.log` z 30.9. cca 12:00–12:02), než jeden z dvojice
prohrál a spadl a zůstal běžet jeden. Nikdo ale finálně nezůstal nefunkční —
heartbeaty se srovnaly, žádný zásah navíc nebyl potřeba.

U devbota to bylo horší: restart vlastního profilu nejde spustit synchronně
uvnitř běžícího tahu (viz `TASKS.md` — sebe-restart zabije proces, který
zrovna generuje odpověď uživateli), takže jsem ho naplánoval jako detached
background skript se `sleep 20` před kill+restart. I ten ale běžel bez
vypnutí cronu, takže se do stejného 409-konfliktu zamotal i devbot — a
protože vlastní restart zabil proces uprostřed generování odpovědi na
schválení mergu, uživatel tu odpověď vůbec nedostal (ticho, pak se sám zeptal
"co se stalo?"). Přesně to je scénář, co řešíme v `TASKS.md` u tématu
"automatické ozvání se" — teď je jasné, že souvisí i se sebe-restartem, ne
jen s `handleUnsolicitedLine`.

**Alternatives:**
- Nechat cron běžet a spoléhat na to, že se to samo srovná (jak se nakonec
  stalo u 7 profilů) — zamítnuto pro devbota, protože tam vedlejší efekt
  (ztracená odpověď uživateli) není přijatelný, i když se produkční stav sám
  opraví.

**Date:** 2026-09-30

## Vyšší autonomie: úkoly z TASKS.md bez dalšího specu, dávky přes víc subagentů, jeden checkpoint (7.10.)

**Rozhodnutí:** Úkol zapsaný v `TASKS.md` se bere jako schválený spec. Víc
úkolů se dělá paralelně přes subagenty ve vlastních worktrees a do `main` jdou
v jednom konsolidovaném checkpointu. Schválení zůstává jen pro restarty,
crontab, mazání a bezpečnostní nastavení, a sbírá se najednou.

**Why:** Uživatel schvaluje skoro všechno a opakovaně řekl, že dílčí dotazy
jsou zbytečné ("už po miliontý"). Zapsáno do `CLAUDE.md` (sekce Autonomie) a
do paměti, aby se to přestalo ignorovat.

**Date:** 2026-10-07

## Docker pilot: dvě skupiny kontejnerů, `~/.claude` jako ro adresářový mount (iterace 6–11, shrnutí 7.10.)

**Rozhodnutí:** Místo kontejneru na bota běží `daily-bots` (assistant, zpravodaj,
mailista, joby, nakup, trener) a `project-bots` (fbalbums). Cutover po jednom
profilu (nakup → assistant → zbytek), `watchdog.sh` hlídá kontejner přes
`compose ps` + `exec pgrep`, `pid: host` + mounty `sessions`/`cc-socks` kvůli
`ListAgents`/`SendMessage`. Od iterace 11 je `~/.claude` mountovaný jako celý
adresář read-only (kontejnery token nerefreshují, vidí vždy aktuální soubor).
Devbot zůstává na hostu (nemůže restartovat sám sebe).

**Why:** OOM izolace a rychlý restart při těsné paměti (6 kontejnerů by byl
moc overhead). Single-file bind mount drží starý inode po tmp+rename (zjištěno u
`.credentials.json`, `META_BOT.md`, `.claude.json`) — proto adresářové mounty.
`Dockerfile.daily` bez `procps` způsobil force-recreate každou minutu (iterace 6).
Otevřené následky viz `TASKS.md` (`.claude.json`, mem_limit, orphan, dashboard).

**Date:** 2026-10-07

## Iterace 12 — mem_limit, pevné názvy, jeden zdroj profilů (7.10.2026)

**Rozhodnutí:** `mem_limit` 1536m (`daily-bots`, naměřeno ~745 MiB) a 512m
(`project-bots`); compose soubory mají `name:` (`agent-system-daily`/`-project`)
a `container_name`, takže compose nehlásí druhý kontejner jako orphan
(`--remove-orphans` se nepoužívá). Seznam denních profilů je v
`daily-profiles.txt` (čte `watchdog.sh`, `start-daily.sh`, dashboard; prázdný
soubor = dashboard při startu spadne). Verze `claude` CLI je jeden `ARG`.

**Why:** OOM izolace a konec sirotčího kontejneru; tři duplicitní seznamy
profilů se rozcházely. Po změně názvu projektu musí následovat `docker rm -f`
starých kontejnerů hned po mergi, jinak je watchdog bere jako "neběží".

**Date:** 2026-10-07

## Autonomie a nasazení (7.10.2026)

**Rozhodnutí:** Uživatel interaguje při analýze/specu, ne při vývoji. Merge do
`main` bez checkpointu; nasazení (recreate `daily-bots`/`project-bots`, restart
dashboardu) trvale povoleno při prázdných frontách a s ověřením heartbeatů.
Schválení zůstává u mazání dat/kontejnerů, crontabu, bezpečnosti a restartu
samotného devbota. Zapsáno v `CLAUDE.md`.

**Date:** 2026-10-07

## Dokumenty do `docs/`, adresářový mount (iterace 13, supersedes iteraci 3)

**Decision:** `META_BOT.md` a `ARCHITEKTURA.md` přesunuty do `docs/`; kontejnery mountují
adresář `./docs` (denní skupina rw, projektová ro). Odkazy v `CLAUDE.md`/skriptech
upraveny na `docs/...`; historické zápisy v `DECISIONS.md`/`TASKS.md` ponechány beze změny.

**Why:** File bind mount je vázaný na inode (tmp+rename zápis i host merge ho rozbijí);
adresářový mount to řeší strukturálně. rw jen v denní skupině, protože tam assistent
dokumenty podle svého `CLAUDE.md` udržuje. Bez pointer souboru/symlinku — v kontejneru by
stejně nebyl namountovaný.

**Date:** 2026-10-07

## Retrospektiva dockerizace (7.10.2026)

**Přínos:** OOM izolace (`mem_limit` daily 1536m / project 512m), rychlý
restart-on-crash přes `docker compose`, jedna šablona pro nové boty. Aktuálně
daily-bots ~835 MiB, project-bots ~173 MiB.

**Náklady:** `~/.claude.json` single-file mount se po změně na hostu (schválení
MCP, OAuth) rozchází s kontejnerem a chce `--force-recreate`; `start-daily.sh` je
COPY v image (změna chce `--build`); `claude -p` cron skripty musí běžet na hostu
(per-bot `cron.txt` přes `watchdog.sh`), takže kontejner jich část nepokryje; každá
změna sdíleného kódu restartuje všechny boty v kontejneru; opakované incidenty
(chybějící `procps`, stale credentials inode, sirotčí kontejner).

**Stav:** kontejnery zůstávají (nic nemažeme bez schválení). Rozhodnutí o
případném návratu na host je na uživateli; další dockerizační práce (devbot do
kontejneru, TASKS č. 9) pozastavena.

**Date:** 2026-10-07

## Telegram UX, druhá vlna: reply, reakce, bez editMessageText

**Decision:** (1) Výsledek úkolu (`✅`/`⚠️ Úkol selhal`) i "ve frontě" hláška jdou
jako odpověď na zprávu uživatele (`reply_parameters` s
`allow_sending_without_reply`); `message_id` je v `Job` (`job_queue_ts.json`) a
v položce outboxu. Reply se dává jen na první chunk dlouhé zprávy. (2) Potvrzení
příjmu u nečekající zprávy je reakce 👀 (`setMessageReaction`) místo textu
"Zpracovávám"; při selhání API se pošle původní text. Fronta dál posílá text
(nese pozici). (3) `editMessageText` se nezavádí.

**Why:** méně zpráv v chatu, jasné párování odpovědi s dotazem. Každé volání má
fallback: odmítnutý reply (400) se zopakuje bez reply, reakce při chybě padá na
text; ne-400 chyby jdou dál do outboxu k opakování, takže doručení se neblokuje.

**Alternatives:** `editMessageText` pro průběžný status — zamítnuto, žádný
průběžný status neexistuje (jen typing indikátor) a editace neposílá push
notifikaci, uživatel by o hotovém výsledku nevěděl. Logika je v
`bridge-ts/src/telegramSend.ts`, testy `npm test` (node:test přes tsx).

**Date:** 2026-10-07

## Self-restart waits for the turn to finish (TASKS 6)

**Decision:** `restart_devbot.sh` no longer does a blind `sleep 60` before
killing devbot. It polls until `job_queue_ts.json` has no jobs and
`outbox_ts.json` is empty on two consecutive 2s polls (after a 5s minimum
wait), capped at `QUIESCE_TIMEOUT` (600s). On timeout it restarts anyway and
sends a Telegram alert. No bridge-ts change.

**Why:** `processQueue()` shifts the finished job off the queue and, in the
same synchronous tick, appends to `chat_history.txt` and enqueues the reply
into the outbox (removed only after Telegram accepted it). So "queue empty and
outbox empty" is gap-free proof that the turn is in history and delivered. A
turn running longer than 60s used to be killed mid-reply.

**Alternatives:** polling `chat_history.txt` mtime (can't tell "turn done"
from "other write"); an explicit bridge-ts "drain" signal/endpoint (larger
diff, new IPC for one script). Fallback on timeout is safe: a job left in the
queue is retried by the new process and the outbox is flushed on startup.
Limits: unsolicited cross-session turns are not in the queue and are not
awaited (no busy signal exists for them); a job parked behind a rate-limit wait
counts as quiet; with a user message queued behind the current one the script waits
for that too (up to the cap).

## Watchdog iterace B: detekce OAuth výpadku přes marker soubor

**Decision:** `bridge-ts` zapisuje `personal/<bot>/auth_error_ts.txt` při `auth_error` a maže ho při jakémkoli ne-auth výsledku (úspěch i běžná chyba),
Nový `auth_watch.sh` (volaný z `watchdog.sh`) marker čte a pošle jedno
Telegram upozornění na výpadek a jedno na obnovu (stav v `/tmp/auth_watch_state`, přechod
prázdná/neprázdná množina postižených botů). Marker starší než `~/.claude/.credentials.json`
se bere jako obnovený. Nic se automaticky nerestartuje.

**Why:** restart nepomůže (kontejnery mají credentials `:ro`, refresh dělá jen host), takže
správná reakce je člověk. Marker je zadarmo (žádná kvóta ani RAM) a bridge už `auth_error`
spolehlivě rozpoznává.

**Alternatives:** aktivní sonda `claude -p` v intervalu — zamítnuto, spotřebovává kvótu a
~200 MB RAM na těsném hostu a sama by mohla spustit refresh; číst jen `expiresAt` z credentials
— expirace je normální, dokud nikdo nevolá claude. Známé omezení: bez provozu se výpadek
nezjistí; aktivní sonda zůstává možné rozšíření.

**Date:** 2026-10-07

## Busy marker for unsolicited turns (TASKS 6 follow-up)

**Decision:** `bridge-ts` writes `personal/<bot>/busy_ts.txt` (`busy.ts`) when a
turn starts and removes it when it ends. Covered: `send()` (cleared in `finally`,
so also on error/timeout), unsolicited turns (set on the first `assistant` event
outside `send()`, cleared on `result`), process exit, and `start()` (leftover
from a crash). `restart_devbot.sh` treats a present marker as not quiet; a
marker older than `BUSY_STALE_SEC` (1800s) is ignored.

**Why:** the queue/outbox check could not see cross-session turns, which are
not in the queue (limit noted in "Self-restart waits for the turn to finish").

**Limits:** an unsolicited turn is marked from its first `assistant` event, not
from the arrival of the message, so there is a short gap. Takes effect for the
restart script only after bridge-ts itself is restarted with this change.

## chat_history.txt rotation: trim in place, drop the old part

**Decision:** `appendHistory()` rotates `chat_history.txt` once it exceeds 200 KB: keeps the
newest <=100 exchanges and <=100 KB (never fewer than `HISTORY_EXCHANGES`), written to
`.tmp` and `rename`d. Trimmed exchanges are dropped, not archived.

**Why:** `getHistory()` only serves the last 10 exchanges; an archive would just move the
unbounded growth elsewhere. Single sync writer per bot process, so tmp+rename is enough.
The existing count-only cap could rewrite on every append for huge exchanges; the byte
bound fixes that. Tests: `bridge-ts/src/history.test.ts`.

**Date:** 2026-10-07

## Devbot stays on the host (task 9 rejected)

**Decision:** devbot is not moved into a container. It stays a host process with full
access to the repo, crontab and docker.

**Why:** it is the independent fixer when containers, compose or cron break (it already
saved us during cron incidents). Inside a container it would need the docker socket
(effectively root on the host) or a request-file mechanism served by a host script
(every new capability would need the host script extended). Both are worse than the
status quo. The only real gain, clean self-restart, is handled separately (task 6).

**Date:** 2026-10-07

## Přesunuto z `personal/assistant/DECISIONS.md` (7.10.2026, infrastrukturní záznamy)

Historická rozhodnutí o `bridge`/`bridge-ts`, watchdogu, dashboardu, zakládání botů a incidentech. Text beze změny (jen úrovně nadpisů).

### bridge.py: restart-on-crash přes cron watchdog + session resume (17.8.)

Decision:
Dvě opravy `bridge.py` (`/home/agent/agent-system/bridge.py`, mimo `personal/assistant`,
ale dokumentováno tady, protože se týká provozu Assistant agenta):

1. **Restart-on-crash přes cron watchdog**, ne systemd unit. `watchdog.sh` (v
   `/home/agent/agent-system/`) kontroluje každou minutu (`crontab -e`), jestli
   `python3 bridge.py` běží, a pokud ne, nastartuje ho a zaloguje do `watchdog.log`.
2. **Session resume místo textové rekonstrukce historie.** `bridge.py` teď volá
   `claude -p ... --resume <session_id> --output-format json`, session ID drží
   v `personal/assistant/session_id.txt`. `chat_history.txt` a textová rekonstrukce
   (`get_history`) zůstávají jako fallback pro první zprávu a pro případ, že by
   `--resume` selhal (expirovaná/smazaná session) — `run_claude()` v tom případě
   spadne zpět na starý postup a založí novou session.

Why:
Na serveru nemám root (`sudo` odmítnuto) ani přístup k Dockeru (`docker.sock` permission
denied), takže nejde nastavit systemd unit s `Restart=always` ani spustit `bridge.py`
v kontejneru s `restart: always`. Cron už běží a je dostupný bez zvláštních práv, takže
je to nejjednodušší funkční náhrada v mezích toho, co mám k dispozici — bez zásahu
uživatele. Session resume nahrazuje ruční vkládání posledních 10 výměn do promptu:
šetří tokeny a zachovává skutečný stav konverzace (ne jen text), viz rozhodnutí o
`HISTORY_EXCHANGES` výše.

Vedlejší zjištění, které stojí za pozornost: v `/home/agent/agent-system/` leží
`Dockerfile` + `docker-compose.yml` (`restart: always`) + `app.py` — starší prototyp
z 16.8. (echo bot, ne `bridge.py`), který se reálně nepoužívá (běžící proces je holý
`python3 bridge.py` na hostu, ne v kontejneru). Nerozhodnuto, jestli to smazat, nechat
ležet, nebo na to případně přejít, až/pokud bude k dispozici root nebo docker přístup —
čeká se na vstup uživatele.

Alternatives:
1. Systemd unit (`Restart=always`) — zamítnuto, chybí root.
2. Dockerizace `bridge.py` přes existující `docker-compose.yml` (`restart: always`) —
   zamítnuto pro teď, chybí přístup k docker socketu a šlo by o větší zásah (mount
   `.env`, `chat_history.txt`, `session_id.txt`, `claude` CLI autentizace v kontejneru)
   bez možnosti to ověřit.
3. Celá výměna za Ludwigův `Agent2Telegram`/`AgentsMonitoring` — zamítnuto, viz níže,
   nemám zdrojový kód na posouzení a je to komplexita nad rámec zadání.

Date:
2026-08-17

### Jeden trvale běžící claude proces (stream-json) místo procesu na zprávu (17.8.)

Decision:
`bridge.py` přechází z modelu "nový proces `claude -p` na každou zprávu" na **jeden
trvale běžící proces**, komunikace přes `claude -p --input-format stream-json
--output-format stream-json --verbose`. Zpráva se posílá jako jeden řádek NDJSON na
stdin (`{"type":"user","message":{"role":"user","content":[...]}}`), konec tahu se
pozná podle řádku `{"type":"result", "result": "...", "is_error": ...}` na stdout.
`session_id` se průběžně ukládá do `session_id.txt` (stejný soubor jako dřív) i tady,
takže restart bridge.py (watchdog) může proces znovu napojit přes `--resume`. Padne-li
proces uprostřed provozu, `run_claude()` ho tvrdě restartuje a jednou to zkusí znovu;
když selže i restart, spadne zpět na čistě novou session s textovou historií
(`chat_history.txt`) jako jednorázový fallback — stejný mechanismus jako dřív.

Why:
Uživatel chtěl řešit cold-start latenci (start `claude` binárky trvá pár vteřin) —
to `--resume` samo o sobě neřeší, protože pořád spouští nový proces na zprávu.
Zvažoval jsem Ludwigův vzor (trvalý proces v `tmux`, zprávy posílané přes
`send-keys`, konec odpovědi odhadovaný z terminálového výstupu) — zamítnuto, protože
detekce "hotovo" z živého terminálu je křehká (žádný jasný signál konce, na rozdíl od
strukturovaného JSON). Místo toho `claude --input-format stream-json --output-format
stream-json` — ověřeno ručně (shell i Python subprocess), řeší přesně tohle: trvalý
proces bez TUI, čistá NDJSON hranice zpráv, `{"type":"result"}` jako jednoznačný
signál konce tahu. Kontext mezi zprávami drží nativně sám běžící proces (ověřeno
dvoutahovým testem s "zapamatuj si číslo" → funguje bez `--resume`), takže `--resume`
teď slouží jen jako záchranná síť pro restart po pádu, ne jako běžná cesta.

Nasazení proběhlo živě, v rámci session, kterou tahle zpráva sama prochází — restart
starého `bridge.py` procesu byl naschválně odložený (`sleep 12` v odděleném detached
procesu) tak, aby proběhl až po doručení téhle odpovědi uživateli přes Telegram, ne
uprostřed jejího zpracování.

**Zjištěná past (17.8., druhé nasazení téhož mechanismu):** Pevná rezerva (`sleep N`)
odhaduje jen dobu doručení *aktuální* odpovědi, ne dobu zbytku *tahu* — pokud stejný
tah po naplánování restartu ještě dělá další nástrojová volání (editace souborů,
research), restart může spustit dřív, než je odpověď vůbec hotová, a starý proces se
zabije uprostřed čekání na ni. Uživatel pak vidí jen "🚀 aktivní" bez odpovědi.
Příště: buď naplánovat restart jako **poslední** akci v tahu, nebo dát rezervu s
velkou rezervou (desítky vteřin), ne odhad podle jedné odpovědi.

Alternatives:
1. Tmux + `send-keys` + scraping terminálového výstupu (Ludwigův vzor) — zamítnuto,
   křehčí detekce konce odpovědi než strukturovaný JSON, bez odpovídajícího benefitu
   navíc (paměť mezi zprávami řeší `--resume`/`stream-json` stejně dobře).
2. Nechat současný model (nový proces + `--resume` na zprávu) — zamítnuto na
   explicitní žádost uživatele, cold-start latence byla reálná bolest.

Date:
2026-08-17

### Produkce přepnuta z bridge.py na bridge-ts (17.8.)

Decision:
Produkce přepnuta z `bridge.py` (Python) na `bridge-ts` (`/home/agent/agent-system/
bridge-ts/`, TypeScript + grammY). Cron watchdog (`watchdog.sh`, `* * * * *`) teď
hlídá `pgrep -f "tsx src/index.ts"` a restartuje `npx tsx src/index.ts`, ne
`python3 bridge.py`. `bridge.py` zůstává na disku nedotčený jako referenční kód,
ale nic ho už nespouští.

Why:
Uživatel chtěl JS/TS, aby uměl vlastní infrastrukturu sám ladit (viz diskuse 17.8.).
Nová verze navíc řeší reálný bug ze stejného dne — `bridge.py` zpracovává zprávy
striktně sekvenčně, takže zpráva poslaná během zpracování předchozí zůstane bez
potvrzení, dokud předchozí tah neskončí. `bridge-ts` na ni hned odpoví "ve frontě" a
zpracuje ji hned po předchozí. Zahrnuje i vzory z Ludwigova `Agent2Telegram`
(code review 17.8.): heartbeat soubor (`heartbeat_ts.txt`, detekce zaseknutého
procesu, ne jen spadlého), perzistentní frontu odchozích zpráv s retry
(`outbox_ts.json`), a crash-fallback na čistou session s textovou historií — stejný
mechanismus jako `bridge.py` měl už předtím.

První pokus o živý test (17.8., ~11:16) spadl na `409 Conflict: terminated by other
getUpdates request` — cron watchdog v tu chvíli ještě hlídal `bridge.py`, viděl ho
zastavený a nastartoval ho zpátky, zatímco `bridge-ts` už pollovala stejný bot token.
Oprava pro druhý pokus: watchdog se na dobu přepnutí v cronu dočasně vypnul úplně
(`crontab -l | grep -v watchdog.sh | crontab -`), teprve po startu `bridge-ts` a
ověření, že po pár vteřinách ještě žije, se `watchdog.sh` přepsal na TS variantu a
cron se zapnul zpátky. Druhý pokus (~11:22) proběhl bez konfliktu.

Sdílené soubory mezi oběma verzemi (schválně, kvůli bezpečnému přepínání):
`session_id.txt`, `chat_history.txt`, `inbox/`. Nesdílené (oddělené jmenné
prostory): `heartbeat_ts.txt`, `outbox_ts.json`, `bridge_ts_claude_stderr.log`
(TS má vlastní, Python měl `bridge_claude_stderr.log`).

Alternatives:
1. Nechat běžet Python natrvalo — zamítnuto, uživatel explicitně chtěl umět vlastní
   infrastrukturu ladit, a Python byl bariéra.
2. Testovat live bez vypnutí cronu — to je přesně to, co spadlo napoprvé; watchdog
   nerozlišuje "bridge.py zastavený záměrně kvůli testu" od "bridge.py spadl", takže
   jakýkoli záměrný výpadek delší než pár vteřin bez vypnutí cronu riskuje kolizi.

Date:
2026-08-17

### Proaktivní cyklení claude session podle velikosti kontextu (17.8.)

Decision:
`bridge-ts` teď proaktivně cykluje `claude` session, místo aby donekonečna
`--resume`ovala jednu pořád rostoucí session. Po každém tahu se z `result` eventu
přečte `usage` (`cache_read_input_tokens` + `cache_creation_input_tokens` +
`input_tokens`) a uloží jako `lastContextTokens`; překročí-li
`CONTEXT_CYCLE_THRESHOLD_TOKENS` (150 000, `config.ts`), založí se před ZAČÁTKEM
příští zprávy (ne uprostřed té právě odeslané) čerstvá session bez `--resume`,
seednutá stejným `HISTORIE KONVERZACE` promptem jako crash-fallback (sdílená
funkce `buildSeedPrompt`, `claudeProcess.ts`).

Why:
Uživatel upozornil, že ranní pád na "session limit" (17.8., viz předchozí decision o
přechodu na trvalý proces) byl jen zmírněný (subagenti, útlé CLAUDE.md), ne
vyřešený — `--resume` na jednu stále rostoucí session znamená, že se při každém
tahu (i přes cache) znovu "připomíná" čím dál větší historie, takže cena/spotřeba
pětihodinové kvóty za zprávu roste s délkou života session bez stropu. Ověřeno
ručně (`claude -p --input-format stream-json ... echo '...'`), že `result` event
nese přesně tahle čísla (`usage.cache_read_input_tokens` atd.) i separátní
`rate_limit_event` s `rateLimitType: "five_hour"` — potvrzuje, že jde o kvótu na
spotřebu, ne primárně o přetečení 1M token context window (sonnet-5), které je
řádově dál. Cyklení tedy cílí na cenu/kvótu za tah, ne na riziko ztráty kontextu —
trvalé znalosti stejně žijí v `DECISIONS.md`/`TASKS.md`/`CLAUDE.md`, ne v surové
konverzaci, takže čerstvá session o nic důležitého nepřijde.

Threshold 150 000 tokenů je odhad s rezervou (baseline overhead i čerstvé session
je ~20k jen na system prompt/nástroje/skilly), ne změřená hranice skutečné
pětihodinové kvóty — může se časem doladit podle skutečné spotřeby.

Alternatives:
1. Čistě reaktivní (jen crash-fallback, beze změny) — zamítnuto, to je přesně to,
   co už dnes ráno jednou selhalo (limit se nezjistí, dokud se na něj nenarazí).
2. Cyklit podle pevného počtu zpráv/tahů — zamítnuto, neodráží skutečnou cenu (tah
   s hodně nástrojovými voláními stojí jinak než prostá otázka), `usage` z eventu
   je přímý signál místo odhadu.

Date:
2026-08-17

### Oprava: race condition v ClaudeProcess způsobovala falešné "EOF" chyby

What:
`bridge-ts/src/claudeProcess.ts` — `kill()`+`start()` (používané při proaktivním
cyklení session i při restartu po pádu) sdílely `waiters`/`lineQueue` napříč
starým a novým `claude` subprocesem beze zbytku. `kill()` posílá jen SIGTERM,
starý proces doopravdy skončí až o něco později; jeho `'exit'` listener zůstal
navázaný na starý proces, ale volal metody na sdíleném `this` — takže když
starý proces konečně umřel, sebral čekatele (waiter) patřícího odpovědi NOVÉHO
procesu a `send()` vyhodil falešné "claude proces skončil (EOF na stdout)",
i když nový proces běžel v pořádku a jen ještě neodpověděl. Oprava: `start()`
teď váže `'exit'`/`'line'` listenery na konkrétní instanci procesu (lokální
`const proc`), ne na `this.proc`, a ignoruje eventy, pokud mezitím `this.proc`
ukazuje jinam; `waiters`/`lineQueue` se navíc při každém `start()` vyprázdní.

Souběžně opraveno i `bridge-ts/src/index.ts` — `bot.start()` teď při 409
Conflict (Telegram krátce po restartu ještě drží staré long-poll spojení)
zkusí pár rychlých pokusů s narůstajícím čekáním (2s–30s) místo okamžitého
pádu procesu a čekání na cron watchdog (až minutu).

Why:
Uživatel narazil dnes dvakrát na `⚠️ Nepodařilo se spojit s Claude procesem:
Error: claude proces skončil (EOF na stdout)` přesně po hlášce "Proaktivní
cyklení session" (log ukazuje 510088 a 684568 tokenů) — obě chyby beze stopy v
`bridge_ts_claude_stderr.log`, což ukazovalo na chybu v bridge kódu, ne v
`claude` CLI samotném. Rekonstrukce z `bridge_ts.log`/kódu potvrdila přesnou
race popsanou výše. Nesouvisí s tím, že uživatel poslal úkol i druhému botovi
(zpravodaj) souběžně — každý bot běží ve vlastním procesu s vlastním tokenem,
žádný sdílený stav mezi nimi není; zpravodajova chyba ten den byla čistě 409
Conflict na jeho vlastní Telegram token při startu, nezávislá věc.

Nasazeno restartem obou instancí (`assistant` i `zpravodaj`, sdílí stejný
zdroják) přes `redeploy_eof_fix.sh` — stejný bezpečný postup jako dřívější
přepnutí (cron watchdog dočasně vypnutý, ~60s prodleva ať se stihne odeslat
rozpracovaná odpověď, pak restart, ověření, cron zpět).

Date:
2026-08-17

### Otevřené otázky pro budoucího meta-bota (bota, co bude vytvářet jiné boty)

What:
Při testování zpravodaje (první reálně běžící druhý agent vedle mě) padly dvě
otázky, které zatím neřešíme, ale je potřeba se k nim vrátit, až budeme
navrhovat orchestrátora/meta-bota, který by sám zakládal a spouštěl další boty:

1. **Viditelnost stavu ostatních agentů.** Zatím řešeno nejjednodušší cestou —
   běžím na stejném serveru se stejným userem jako zpravodaj, takže si jeho
   `chat_history.txt`/`heartbeat_ts.txt`/`session_id.txt` v `personal/zpravodaj/`
   umím přečíst přímo, bez zvláštního mechanismu. Stačí to pro roli "shrnuji
   stav ostatních agentů" (sekce 8 architektury) při ručním dotazu, ale
   neřeší to aktivní monitoring/alerting přes víc agentů najednou — až jich
   bude víc, možná bude potřeba společný status formát/agregace.

2. **Sandboxing/omezení přístupu bota do zbytku serveru.** Zpravodaj i budoucí
   mail agent píšu já sám, běží se stejnými právy jako já — omezovat je teď je
   zbytečná komplexita bez reálného rizika (viz princip "simple first" v
   `CLAUDE.md`). Jakmile ale bude existovat meta-bot, který sám generuje a
   spouští kód pro nové boty (ne já ručně), riziko je jiné — ten kód by nemusel
   být prověřený. Tam už dává smysl izolace (vlastní OS user s omezenými právy,
   nebo kontejner na bota) — hlavní trade-off je víc provozní komplexity
   (setup, deploy, debugging přes hranici izolace) proti bezpečnosti.

Why:
Uživatel chtěl tyhle dvě otázky zapsat teď, ať se na ně při návrhu meta-bota
rovnou doptáme, místo aby se znovu objevovaly odznova v konverzaci bez záznamu.
Není to (zatím) rozhodnutí, jak to uděláme — jen otevřené otázky k řešení, až
bude meta-bot skutečně na pořadu (dnes ho nikdo nestaví).

Date:
2026-08-17

### Oprava: usage limit hlášku bral bridge jako hotovou odpověď, úkol se ztratil beze stopy

What:
`bridge-ts` (sdílený zdroják assistant/zpravodaj/mailista) dřív bral text jako
"You've hit your session limit · resets 3:50pm (UTC)" (to, co `claude` CLI vrátí
místo skutečné odpovědi, když narazí na 5h/týdenní kvótu) jako běžný dokončený
výsledek — poslal ho uživateli jako "✅ Výsledek", zapsal do historie a job zahodil
z fronty. Rozpracovaný úkol tím zmizel beze stopy, žádné upozornění navíc nepřišlo
v momentě, kdy se kvóta zase obnovila.

Oprava, čtyři části:
1. `src/rateLimit.ts` — rozpozná hlášku o limitu (regex na "you've hit your ...
   limit") a umí z ní vytáhnout čas obnovení, i formátovat ho do místního času
   uživatele (`USER_TIMEZONE`, default `Europe/Prague` — server běží v UTC).
2. `src/claudeProcess.ts` — `send()` navíc parsuje strukturovaný `rate_limit_event`
   (`rate_limit_info.status === "rejected"`), který `claude` CLI posílá ve
   stream-json módu vedle textové hlášky — dává přesný `resetsAt` (epoch), textový
   regex je jen fallback, když by struktura chyběla. `runClaude()` vrací nově
   `RunClaudeOutcome` (`"ok"` / `"rate_limited"`) místo holého stringu — u
   `rate_limited` se NEZKOUŠÍ restart+retry (kvóta se tím neobnoví, jen by se
   zbytečně zkoušelo znovu narazit na stejný limit).
3. `src/index.ts` — `processQueue()` job při `rate_limited` výsledku nechá na
   začátku fronty (nezahazuje), pošle uživateli zprávu s místním časem obnovení a
   naplánuje `setTimeout` na automatické pokračování po resetu (+30s rezerva).
   Během čekání nová příchozí zpráva frontu jen prodlouží, ne že by se zkoušelo
   bušit do limitu znovu (early return v `processQueue()`, dokud čekací lhůta
   neuplyne).
4. `src/queue.ts` — fronta úkolů (`jobQueue`) i čekací stav na reset kvóty se teď
   persistují do `job_queue_ts.json` (stejný vzor jako `Outbox`), načítají se zpět
   při startu (`restoreQueueState()`). Dřív fronta žila jen v paměti — pád/restart
   bridge procesu (i z jiného důvodu, ne jen z limitu) by rozpracovaný i čekající
   úkol tiše smazal.

Souběžně nasazeno i dřív odsouhlasené (17.8., "Chceš, ať bod 1 rovnou opravím a
nasadím?" → "ano", ale odpověď přerušil právě tenhle usage limit, než se stihlo
nasadit): globální `process.on("unhandledRejection"/"uncaughtException")` v
`index.ts`, co jen loguje místo pádu celého procesu. Relevantní i pro tuhle
opravu — bez toho by nezachycená chyba mohla smazat vícehodinové čekání na reset
kvóty, kdyby k ní došlo v mezičase.

Why:
Uživatel narazil na to, že se po obnovení kvóty bridge k rozpracovanému úkolu
nevrátil a žádné upozornění nepřišlo ani v moment limitu, ani při obnovení. Časy
jsou uživateli smysluplné jen v místním čase, ne v UTC, co CLI hlásí.

Alternatives:
1. Jen text-only detekce bez strukturovaného `rate_limit_event` — zamítnuto,
   textová hláška ("3:50pm (UTC)") nedává datum, jen hodinu — u limitů blíž
   půlnoci by šlo snadno špatně určit den. Strukturovaný event dává přesný epoch.
2. Fronta jen v paměti (bez `job_queue_ts.json`) — zamítnuto, hlavní stížnost byla
   přesně "úkol se ztratil" a vícehodinové čekání na reset kvóty výrazně zvyšuje
   šanci, že bridge mezitím spadne/redeployne se z jiného důvodu.

Date:
2026-08-17

### Oprava: timeout v send() nechal starý proces běžet dál a "ukradl" odpověď další zprávě

What:
Živý incident dnes (17.8., těsně po předchozí opravě výše, ještě před jejím
nasazením): odpověď na "Měl by jsi nějak ošetřit to, že když dojdou tokeny..."
přišla uživateli jako `⚠️ Nepodařilo se spojit s Claude procesem: Error: claude
proces neodpověděl včas`. Vyšetřením (běžící procesy, `bridge_ts.log`,
`chat_history.txt`) se ukázalo, že jde o samostatný bug, ne o omyl v nasazení:
`send()` má pevný timeout (`CLAUDE_TURN_TIMEOUT_MS`, 280s) na celý tah včetně
všech nástrojových volání. Tenhle konkrétní tah (psaní 4 nových/upravených
souborů + typecheck + zápisy do `DECISIONS.md`/`TASKS.md`) ho přesáhl. Když
`send()` timeoutne, dřív jen `cancel()`+`break` — `claude` proces samotný ale
BĚŽEL DÁL, protože timeout je jen bridge, co se vzdal čekání, ne signál pro CLI.
`runClaude()` po prvním timeoutu udělá `cp.kill()`+`cp.start(null)` a zkusí to
znovu s čerstvou session — ale když TATO druhá zkouška taky timeoutne (tenhle
případ), `runClaude` už proces podruhé nezabije, jen vrátí chybovou hlášku.
Zombie proces z druhého pokusu zůstal běžet dál na pozadí, `isAlive()` ho
správně hlásil jako živý. Když pak přišla DALŠÍ zpráva od uživatele ("Ok něco
se pokazilo, zjisti co a případně to vyřeš"), `runClaude` — protože proces
"žil" — ho jen poslal do stdin toho stále běžícího zombie procesu, MÍSTO aby
založil nový. Ten zombie proces mezitím doopravdy dokončil svůj (zapomenutý,
"odepsaný") tah a jeho `result` event ukradl waiter patřící DRUHÉ zprávě —
uživatel tak na "co se pokazilo?" dostal odpověď "Kód je hotový, mám nasadit?"
(= dokončený popis fixu, ne diagnóza incidentu) — správný obsah, ale spárovaný
se špatnou otázkou. `chat_history.txt` to zapsalo přesně takhle propletené.

Oprava: `send()` teď při timeoutu proces rovnou zabije (`this.kill()`) dřív, než
vyhodí chybu — `isAlive()` pak po timeoutu spolehlivě vrací `false`, takže
příští `runClaude()` volání vždycky založí čerstvou (`--resume`) session místo
znovupoužití zombie procesu. Navíc přestane zombie proces zbytečně dál žrát
tokeny/kvótu na pozadí bez toho, aby o tom bridge věděl.

Why:
Bez tyhle opravy je párování zpráv/odpovědí trvale posunuté o jednu, jakmile
jednou dojde k timeoutu na retry pokusu (ne jen na prvním) — dokud se proces
sám nerestartuje z jiného důvodu (proaktivní cyklení, pád). Navíc pravděpodobně
souvisí i s dřívějším propadem přes 5h kvótu (zombie tahy dál spotřebovávaly
tokeny, i když je bridge už "vzdal").

Date:
2026-08-17

### Incident: zpravodaj (ne mailista) ručně restartoval "hlavního bota", duplicitní proces shodil všechny tři

What:
Ráno 18.8. mi (assistant) došel kontext uprostřed nasazení rate-limit fixu
(`bridge_ts_switch.log` končí na "[redeploy-rate-limit-fix] assistant zastaven"
v 06:10, žádný navazující řádek) — zůstal jsem dole. Uživatel na mě nedostal
odpověď, zkusil to přes **zpravodaj bota** (ne mailistu — ověřeno, `personal/
mailista/chat_history.txt` má k tomu incidentu nulovou zmínku, celý průběh je
zapsaný v `personal/zpravodaj/chat_history.txt`). Zpravodaj mě nahodil, ale
udělal to ručně mimo `watchdog.sh` — spustil proces bez `cd` do `bridge-ts` a
bez profilového argumentu. Vzniknul tak druhý, duplicitní `assistant` proces
vedle toho, co mezitím nahodil cron watchdog — oba dva se bily o stejný
Telegram token (409 Conflict), a protože watchdog cron mezitím opakovaně
restartoval všechny tři boty (assistant/zpravodaj/mailista), zmatek se přelil
i na zpravodaje a mailistu. Zpravodaj sám nakonec našel příčinu (duplicitní
proces), ukončil ji a potvrdil, že všichni tři běží v jedné instanci.

Why to zapisuju: ukazuje to hranici širší, než jsme dřív řešili. Dřív padlo
rozhodnutí, že jediné sdílené citlivé místo mezi boty je systémový crontab
(kvůli dřívějšímu incidentu se smazanou zálohou). Tenhle incident ukazuje, že
**sdílené jsou i samotné `bridge-ts` procesy** — libovolný bot (zpravodaj,
mailista) může v nouzi sáhnout po ručním restartu "hlavního bota" a bez
znalosti správného postupu (vždy přes `watchdog.sh`, který dělá `cd` a předává
správný profilový argument) tím věci zhorší, ne opraví.

Otevřená otázka (k rozhodnutí, ne rozhodnuto): má mít zpravodaj/mailista
vůbec dovoleno ručně sahat na `bridge-ts` procesy jiného bota, nebo by měl v
podobné situaci jen informovat uživatele a nechat zásah na mně/uživateli?
Pokud ano, stálo by za to `watchdog.sh` restart postup (ne ruční `tsx src/
index.ts`) zmínit v jejich `CLAUDE.md`, ať se nestane znovu.

Date:
2026-08-18

### Dashboard: `personal/dashboard/` — stav botů + historie restartů

What:
Nový samostatný proces `personal/dashboard/` (Node/TS, `tsx`, vlastní `package.json`
po vzoru `bridge-ts`), čtecí HTTP server na `127.0.0.1:8765` (žádný veřejný port,
bez auth — viz Alternatives). Zobrazuje dvě tabulky:
1. **Stav botů** — čte `heartbeat_ts.txt` ze všech tří `personal/<bot>/` adresářů
   (seznam v `src/config.ts`), stáří < 60s = běží, jinak zaseknutý/spadlý.
2. **Historie restartů** — nová SQLite databáze (`dashboard.sqlite`, `better-sqlite3`).
   `watchdog.sh` při každém restartu bota zavolá `npx tsx src/recordRestart.ts <bot>
   <důvod>` (bash sám SQLite psát neumí, na hostu chybí `sqlite3` CLI), což zapíše
   řádek do tabulky `restarts`. Dashboard k tomu navíc počítá restarty za posledních
   24h na bota.

Dashboard je i sám o sobě čtvrtý proces hlídaný `watchdog.sh` (stejný cron, `* * * *
*`) — startuje se s absolutní cestou (`tsx /home/agent/.../dashboard/src/index.ts`,
ne relativní `src/index.ts`), aby ho `pgrep -f "tsx src/index.ts$"` (check pro
assistant bota) omylem nezachytil jako běžící assistant proces.

Restart/stop tlačítka v UI vynechána — dát webu právo zabíjet procesy ostatních botů
je bezpečnostní rozhodnutí k rozmyšlení (aspoň basic auth), ne věc pro v1.

Why:
Uživatel chtěl monitoring inspirovaný Ludwigovým `AgentsMonitoring` dashboardem
(`agentsmon/dashboard.py` — čtecí web nad tmux process tree + SQLite historie), ale
ve stacku, kterému rozumí (Node/JS/TS), ne v Pythonu, kterým je Ludwigovo řešení
psané — viz rozhodnutí o stacku níže. Rozsah zúžen na body 1+2 (stav + historie
restartů); token usage logging a obsah dalšího logu čekají na to, až se uživatel sám
podívá do kódu `bridge-ts` (WebStorm) a upřesní, co přesně chce logovat.

**Volba stacku (Node/TS místo Pythonu):** Prvotní návrh kopíroval Ludwigův Python
1:1 (nulové závislosti navíc, stdlib `http.server`+`sqlite3`). Uživatel se zeptal,
jestli by přepis do Node/JS/TS byl náročný — ověřeno, že ne (Node má vestavěný
`http`, `fs.readFileSync` stejně triviální), jediný rozdíl je SQLite: Node 20.20 zde
ještě nemá vestavěný `node:sqlite`, takže přibyla jedna závislost (`better-sqlite3`,
uživatel souhlasil, preferoval SQLite před CSV/JSON). Zapsáno i do trvalé paměti —
stack projektu má zůstat Node/JS/TS napříč celým `agent-system`, i když se odněkud
čerpá inspirace v jiném jazyce.

Alternatives:
1. Python 1:1 podle Ludwiga — zamítnuto na žádost uživatele, chce umět celý
   `agent-system` sám ladit, ne přidávat druhý jazykový stack vedle `bridge-ts`.
2. CSV/JSON místo SQLite pro historii restartů (bez `better-sqlite3` závislosti) —
   zvažováno, uživatel zvolil SQLite navzdory jedné závislosti navíc.
3. Bash přímo zapisující do SQLite (`sqlite3` CLI) — zamítnuto, binárka není na
   hostu nainstalovaná; místo instalace systémového balíčku (mimo rozsah projektu)
   zvolen malý TS skript volaný z `watchdog.sh`.

Date:
2026-08-18

### Dashboard rozšíření: aktivita z turn logu, syrový log, restart tlačítko

What:
`personal/dashboard/` doplněn o tři věci, které si uživatel vyžádal po zjištění, že
token/duration logging z bodu 3 (18.8.) sice zapisoval do `turn_log_ts.jsonl`, ale
dashboard ho vůbec nezobrazoval:
1. **Tabulka "Aktivita (posledních 24h)"** — na bota: počet tahů, počet chyb
   (`isError`), průměrná délka tahu (`durationMs`), čas posledního proaktivního
   cyklení kontextu. Čte se přímo z `turn_log_ts.jsonl` (nový `src/turnlog.ts`),
   žádná nová databáze.
2. **Proklik na syrový log** — jméno bota v tabulce aktivity vede na `/log/<bot>`,
   který vrátí posledních 200 řádků JSONL jako `text/plain`. Žádné parsování na
   klientovi, žádná stránkovací logika — nejjednodušší varianta, co šla.
3. **Restart tlačítko** u každého bota ve "Stav botů" — `POST /restart/<bot>`
   validuje jméno proti `BOTS` (config.ts), pošle `SIGTERM` přes `execFileSync("pkill",
   ["-TERM", "-f", bot.killPattern])` (žádná shell interpolace uživatelského vstupu),
   samotné nahození nechává na cron `watchdog.sh` (do minuty) — stejný bezpečný
   postup, jaký byl ručně použitý při restartu 18.8. Potvrzovací JS `confirm()`
   dialog před odesláním formuláře proti omylem kliknutí.

Why:
Uživatel chtěl "zobrazovat co půjde" z nově zapisovaného logu a "klidně proklik na
log, ale ne jestli je to složité" — zvoleno nejjednodušší řešení (přímé čtení
souboru při každém requestu, žádná cache/index). Restart tlačítko bylo v původním
dashboard rozhodnutí (viz sekce výše) explicitně vynechané z v1 jako "bezpečnostní
rozhodnutí k rozmyšlení" — uživatel si ho teď výslovně vyžádal, takže rozhodnutí je
tímto rozšířeno. Dashboard je pořád jen na `127.0.0.1` bez auth, takže restart
tlačítko má stejnou důvěryhodnostní hranici jako SSH tunel sám (kdo se dostane na
dashboard, už má SSH přístup, tedy by mohl `kill` spustit i ručně).

Důležité upozornění dané uživateli: restart tlačítko pro `assistant` bota posílá
SIGTERM procesu, který obsluhuje i tuhle samotnou Telegram konverzaci (`claude` CLI
běží jako přímý child proces bez `detached: true`, viz `bridge-ts/src/claudeProcess.ts`)
— kliknutí na "Restartovat" u assistant bota tedy může přerušit právě probíhající
konverzaci, ze které se na dashboard kliká.

Date:
2026-08-18

### Pravidlo: skripty mimo bridge-ts musí při chybě aktivně upozornit, ne jen logovat

What:
Zpravodajův testovací `ai_news_digest.sh` (přímé volání `claude -p --model opus` z
bashe, mimo `bridge-ts`) v 15:11 UTC spadl (`FAIL status=1` v `ai_news_log.txt`), ale
selhání se nikam neprojevilo — žádná Telegram zpráva, žádný záznam v
`job_queue_ts.json`/dashboardu (protože ten skript běží úplně mimo tenhle
mechanismus). Assistant to našel jen ručním čtením logu, ne aktivním upozorněním.
Ruční opakování stejného volání proběhlo bez chyby, takže příčina vypadá na
jednorázový/přechodný problém, ne trvalou chybu ve skriptu.

Rozhodnuto: obecné pravidlo doplněno do `CLAUDE.md` všech tří botů (assistant,
zpravodaj, mailista) — jakýkoliv skript běžící mimo `bridge-ts`/dashboard (přímé
`claude -p`, cron job) musí při chybě aktivně poslat upozornění (Telegram/
`SendMessage`), ne jen zapsat řádku do logu. Zpravodaj dostal zadání prošetřit
konkrétní pád a doplnit alerting do `ai_news_digest.sh`; cron pro tenhle skript se
nepřidá, dokud to nebude vyřešené a otestované.

Why:
Stejný vzorec jako dřívější dashboardové "právě zpracovává" zjištění — cokoliv, co
běží mimo `bridge-ts`, je pro assistenta/dashboard neviditelné, dokud se aktivně
nezeptá. Bez tohohle pravidla by budoucí cron joby mohly tiše selhávat donekonečna.

Date:
2026-08-18

### Dashboard přístup: Tailscale místo SSH tunelu

What:
Uživatel chtěl dashboard zobrazovat odkudkoliv bez nutnosti chodit do terminálu (SSH
tunel `-L 8765:127.0.0.1:8765` vyžadoval terminál při každém přístupu). Instalace
Tailscale na server vyžadovala root, který `agent` účet nemá (viz Alternatives) —
uživatel to sám spustil se svým vlastním sudo přístupem. Server má teď tailnet IP
`100.108.179.97`. `HOST` v `src/config.ts` změněn z `127.0.0.1` na tuhle IP, takže
dashboard teď poslouchá jen na tailscale rozhraní — ne na `127.0.0.1` (SSH tunel na
`127.0.0.1:8765` už tedy nefunguje) a ne na `0.0.0.0` (veřejný internet). Proces
restartován přes `pkill` + cron watchdog (stejný bezpečný postup jako restart
tlačítko), ověřeno `curl http://100.108.179.97:8765` → 200.

Why:
Důvěryhodnostní hranice dashboardu (bez auth, viz sekce výše) byla "kdo má SSH
přístup na server". Tailscale posouvá tuhle hranici na "kdo je v uživatelově
tailnetu" — pořád privátní síť, ne veřejné vystavení, ale přístupná z telefonu/
notebooku bez SSH. Zvažovaná alternativa (Cloudflare Tunnel s veřejnou URL) zamítnuta,
protože by vyžadovala přidat auth k dashboardu (dnes žádná není) — Tailscale tohle
riziko nemá, protože síť samotná už je přístupová kontrola.

Alternatives:
1. Cloudflare Tunnel s veřejnou URL — zamítnuto, vyžaduje přidat login/auth k
   dashboardu, což je mimo rozsah tohoto požadavku.
2. `agent` účet by mohl mít trvalé sudo, aby šlo systémové balíčky (Tailscale)
   instalovat bez zásahu uživatele — zamítnuto, autonomní proces bez dozoru mezi
   zprávami by s neomezeným sudo mohl při chybě/bugu rozbít celý server, ne jen svůj
   vlastní kód; zůstává v souladu s principem nízké autonomie pro bezpečnostní
   nastavení.

Date:
2026-08-18

### Zjištění: SendMessage adresa může zastarat, odpověď se pak tiše neztratí, ale zpozdí

What:
Zpravodaj poslal výsledek testu `ai_news_digest.sh` zpátky přes `SendMessage`, ale
mířil na starou assistant session (`assistant-8e`), která mezitím doběhla/vyměnila
se za novou — socket byl stale. Zpravodaj si toho všiml (chyba doručení) a poslal
zprávu znovu, tentokrát na aktuální session — takže výsledek nakonec dorazil, ale
až po zásahu uživatele ("proč to nic nedalo vědět"), ne hned po dokončení testu.
Bez toho, že si to zpravodaj sám všiml a zopakoval, by zpráva zůstala nedoručená
napořád beze stopy (stejný vzorec jako `ai_news_digest.sh` incident — něco selže
mimo hlavní tok a nikdo se to nedozví).

Why:
`assistant-*` session ID se mění při cyklení kontextu/restartu, ale bot, co na
starou adresu odpovídá (zpravodaj), o tom neví — nemá způsob, jak zjistit aktuální
jméno/ref assistant session jinak než uhodnout nebo si to nechat potvrdit. Tohle
je architektonická mezera v cross-session komunikaci, ne chyba zpravodaje — udělal
správnou věc (všiml si a zkusil znovu).

Alternatives:
Zatím žádná trvalá oprava navržena — nejjednodušší by bylo, aby boti při odpovídání
používali `ListAgents` a hledali podle jména vzoru (`assistant-*`) nejnovější live
session, ne uloženou starou referenci z doby přijetí úkolu. Zvážit, až se tenhle
vzorec zopakuje.

Date:
2026-08-18

### `META_BOT.md`: konsolidovaný zápis architektury + konvencí pro budoucího meta-bota

Decision:
Nový soubor `/home/agent/agent-system/META_BOT.md` (top-level, ne v `personal/`)
shrnuje, jak systém multi-bot delegace reálně funguje (diagram procesů + delegační
protokol), strukturu jednoho bota jako šablonu pro založení dalšího, čtyři vynucené
konvence (jazyk, delegační protokol, alerting skriptů mimo `bridge-ts`, nízká
autonomie), sdílené vs. izolované zdroje mezi boty (včetně 3.7GB RAM limitu stroje) a
odkaz na dřív zapsané otevřené otázky (§17.8. výše). `ARCHITEKTURA.md` sekce 10
(Orchestrator) teď na něj odkazuje.

Why:
Uživatel chtěl obrázek/diagram, jak systém funguje, a explicitně požádal, ať se tyhle
věci zapíšou, aby je znal budoucí "bot na vytváření botů" — ne aby zůstaly rozeseté
po `DECISIONS.md` tří různých botů a musely se znovu dolovat z historie incidentů.
Umístění mimo `personal/assistant/` proto, že jde o znalost napříč celým systémem
(všechny tři boty), ne assistant-specifickou.

Alternatives:
1. Nechat to jen v `DECISIONS.md` jednotlivých botů — zamítnuto, přesně tohle uživatel
   označil za problém (roztroušené, nikdo to celé nepřečte).
2. Rozšířit `ARCHITEKTURA.md` přímo — zamítnuto, je to uživatelův vlastní původní
   plánovací dokument v jiném stylu (krátké body, vize), míchání s provozní realitou
   by ho znečitelnilo; místo toho jen krátký odkaz.

Date:
2026-08-19

### Uniklý OAuth token (15.9.) — ponechán aktivní, vědomé rozhodnutí

Decision:
Při obnově sdíleného Claude CLI přihlášení 15.9. (viz oprava OAuth výpadku výše)
uživatel vložil do terminálu/chatu čerstvě vygenerovaný `claude setup-token`
(`sk-ant-oat01-...`). Token se v provozu nepoužívá (boti běží na jiném
`CLAUDE_CODE_OAUTH_TOKEN` z crontabu), takže jde čistě o exponovaný nadbytečný
token. Anthropic Console přesměrovala uživatele jen na nákup kreditů, ne na
správu/revoke tohoto typu tokenu, takže snadná cesta k odvolání není. Uživatel se
rozhodl token nezneplatňovat — nic kritického za účtem není, riziko je jen
teoretické (únik historie chatu/terminálu).

Why:
Odvolání by nezměnilo nic funkčního (token se stejně nepoužívá), a náklad na
řešení (hledání jiné cesty k revoke) neúměrný nízkému riziku u osobního účtu.

Date:
2026-09-15

### Vlastní restartovací skripty mimo cron nesmí sám spouštět nový proces

Decision:
Skript, který restartuje bota mimo cron (např. po schváleném mergi, spuštěný
přímo z běžící Claude session), smí proces jen ukončit — ne ho hned zase
nastartovat vlastním `nohup`/`disown` z téže bash session. Nový proces má
nechat nahodit cronový `watchdog.sh` (běží každou minutu).

Why:
Sdílený `CLAUDE_CODE_OAUTH_TOKEN` je jen v prostředí systémového crontabu, ne
v žádném `.env` souboru. Proces nastartovaný `nohup` přímo z interaktivní bash
session token nezdědí — vznikne proces, co procesně "běží" (heartbeat tiká,
fronta se tváří zdravě), ale jakýkoliv nový `claude -p` spawn (nový úkol,
subagent) padá na starou/vypršelou `.credentials.json` autentizaci. Vypadá to
jako tichý/nejasný "furt nefunguje" stav, ne jako jasný pád, takže se to špatně
diagnostikuje. Stalo se dvakrát stejným vzorem: 30.9. (sebe-restart po mergi
úklidu komentářů) a 1.10. (`restart_devbot.sh` po mergi rate-limit opravy,
`sk-ant-oat01-...` chybělo v `/proc/<pid>/environ` nového procesu). Oprava
1.10.: ukončit proces bez vlastního restartu, nechat ho nahodit `watchdog.sh`
přes cron (ten token má) — ověřeno v novém `/proc/<pid>/environ`.

Alternatives:
1. Spustit nový proces ručně s explicitně předaným tokenem
   (`CLAUDE_CODE_OAUTH_TOKEN=... nohup ...`) — funkční, ale duplikuje token na
   víc míst (riziko rozjetí/zapomenutí), a crontab zůstává jediným místem
   pravdy pro ostatních 6 profilů. Zamítnuto ve prospěch jednoho zdroje pravdy.
2. Nechat `restart_devbot.sh`/obdobné skripty, jak jsou, a jen dopisovat
   `export CLAUDE_CODE_OAUTH_TOKEN=...` na začátek — zamítnuto, je to další
   místo, které je potřeba ručně udržovat v souladu s crontabem při rotaci
   tokenu; spolehnutí na cron je jednodušší a méně náchylné na rozjetí.

Date:
2026-10-01
