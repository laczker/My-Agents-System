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
