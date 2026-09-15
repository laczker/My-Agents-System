# Poznámky pro budoucího meta-bota (bota, co zakládá další boty)

> Doplňuje `ARCHITEKTURA.md` (sekce 10 „Orchestrator”, sekce 13 „Persistent context”).
> Tam je původní záměr/vize, tady je **jak systém reálně funguje ke dni 2026-09-07**
> a jaké konvence si dosavadní boti (assistant, zpravodaj, mailista, joby, nakup,
> fbalbums, devops) postupně vynutily provozem. Až vznikne bot, který bude sám zakládat a
> spouštět další boty, má tenhle soubor přečíst jako první — ušetří to
> znovuobjevování stejných pravidel přes stejné incidenty.

## 1. Jak to vypadá dnes — diagram

```
                    Uživatel (Telegram, 7 samostatných botů)
      @Assistant   @Zpravodaj   @Mailista   @HlidacJobu   @Nákup   @FbAlbums   @DevBot
            │            │            │            │          │         │         │
      ┌─────▼─────┐┌────▼──────┐┌────▼──────┐┌────▼──────┐┌──▼────────┐┌─▼─────────┐┌─▼─────────┐
      │ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts │
      │(assistant)││(zpravodaj)││(mailista) ││  (joby)   ││  (nakup)  ││ (fbalbums)││ (devops)  │
      │cwd=personal││cwd=personal││cwd=personal││cwd=personal││cwd=personal││cwd=personal││cwd=personal│
      │/assistant/ ││/zpravodaj/ ││/mailista/  ││ /joby/     ││ /nakup/    ││ /fbalbums/ ││ /devops/   │
      └─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘
                    │  vlastní .env.<bot> token, vlastní
                    │  claude proces (stream-json, trvalý)
                    │  session_id.txt, chat_history.txt (fallback)
                    │  job_queue_ts.json, outbox_ts.json
                    │  heartbeat_ts.txt, turn_log_ts.jsonl
                    │
                    └──────── SendMessage (agent-to-agent) ────────┐
                              jediný kanál mezi boty navzájem;      │
                              žádné sdílené soubory kromě crontab   │
                              a samotných bridge-ts procesů (obojí ◄┘
                              je zdroj minulých incidentů, viz §4)

  watchdog.sh (systémový cron, každou minutu)
    hlídá heartbeat/pgrep 8 procesů: assistant, zpravodaj, mailista, joby, nakup,
    fbalbums, devops, dashboard → restartuje spadlý/zaseknutý, zapisuje důvod do dashboard.sqlite

  personal/dashboard/ (5. proces, čtecí web, Tailscale 100.108.179.97:8765)
    - stav botů (heartbeat), aktivita 24h, kvóta, log proklik, restart tlačítko

  personal/zpravodaj/webapp/ (100.108.179.97:8766)
    - samostatná čtecí webovka nad zpravodajovými digesty (per-bot appka,
      ne součást dashboardu)
```

**Delegační protokol** (assistant → jiný bot), ověřený provozem 18.–19.8.:

```
1. Assistant --SendMessage--> Bot                (úkol)
2. Assistant --> uživatel, HNED: "zadávám úkol X botovi Y"
3. Bot --> svůj vlastní Telegram: "📥 Dostal jsem úkol od assistenta: ..."
4. Bot --> svůj vlastní Telegram: "⏳ Zpracovávám: ..."
5. Bot pracuje (může se doptat zpátky assistenta přes SendMessage, ne uživatele —
   výjimka: nevratné/destruktivní akce se ptají přímo uživatele)
6. Bot --> svůj vlastní Telegram: VÝSLEDEK (ne jen přes SendMessage)
```

Kroky 3–4 (📥/⏳) jdou JEN do botova vlastního Telegramu, ne navíc přes `SendMessage`
assistentovi — assistant ví, že úkol zadal, potvrzení přijetí by bylo duplicitní.
Stejně tak prosté dokončení úkolu (krok 6) se `SendMessage` zpátky assistentovi
nehlásí — to by byl jen šum navíc k výsledku, který už je v botově chatu (incident
24.8., uživatel: "nebyl cíl, aby pokaždý co něco budou dělat tě budou informovat").
`SendMessage` zpátky assistentovi (mimo krok 5) posílej **jen** když bot od něj
skutečně potřebuje reakci — dotaz k zadání nebo blokující problém, ne jako obecné
hlášení stavu.

Opačný směr (bot pošle žádost/dotaz assistentovi, ne naopak) je zrcadlový a stejně
povinný — bez něj uživatel o výměně vůbec neví, protože nemá přístup do assistant↔bot
`SendMessage` provozu, jen do jednotlivých Telegram chatů:

```
1. Bot --SendMessage--> Assistant
2. Assistant --> uživatel, HNED: "od koho žádost je, co v ní je, zpracovávám"
3. Assistant vyřeší (sám / nebo přepošle uživateli, pokud nevratné)
4. Assistant --> uživatel: stručné shrnutí vyřešení
   (technická odpověď jde navíc zpátky botovi přes SendMessage)
```

**`[TICHO]` marker — potlačení spamu z opakovaných `CronCreate` probuzení** (incident
20.8., mailista): `bridge-ts` posílá do Telegramu bota živě KAŽDÝ textový blok z tahu,
který si nikdo nevyžádal přes normální `send()` — to zahrnuje jak `SendMessage` od
jiného bota (žádoucí, viz delegační protokol výše), tak i probuzení z vlastního
`CronCreate` (`claudeProcess.ts`, `handleUnsolicitedLine`). Bot, co si přes `CronCreate`
nastaví opakovanou dávkovou smyčku (např. mailista a noční čištění inboxu po dávkách),
tím dřív pádem posílal do svého Telegramu jednu zprávu za každé probuzení (u mailisty
13+ zpráv za noc) — i když si sám do vlastního progress souboru poznamenal, že
"po Telegramu nebude psát po každé dávce". Ten záměr neměl v kódu žádnou páku, protože
`handleUnsolicitedLine` posílá cokoliv neprázdného bezpodmínečně.

Oprava: text unsolicited tahu začínající `SILENT_MARKER` (`"[TICHO]"`, exportováno z
`claudeProcess.ts`) se do Telegramu vůbec neposílá. Bot ho použije, když ví, že jde o
rutinní, opakovaný unsolicited tah (typicky mezikrok dávkové smyčky), kde živé
posílání do Telegramu nedává smysl — genuinní cross-session viditelnost (začátek/konec
delegovaného úkolu, eskalace, `SendMessage` od jiného bota) marker nepoužívá a chodí do
Telegramu dál beze změny. Je to nástroj pro bota, ne vynucené pravidlo — pokud bot chce
mít i u dávkové smyčky nějaký živý "pracuji" signál, může marker vynechat u vybraných
probuzení (např. jen první a poslední v noci) a použít ho jen u těch mezilehlých.

Stejný problém se ale netýká jen opakovaných `CronCreate` probuzení — platí pro
KAŽDÝ unsolicited tah s víc kroky, včetně běžného cross-session zadání od jiného
bota přes `SendMessage`. Delší úkol typicky obsahuje víc `assistant` textových bloků
mezi jednotlivými nástroji (pracovní poznámky typu "teď upravím X", "kontroluju Y") a
`handleUnsolicitedLine` je všechny pošle živě, ne jen finální výsledek — u zpravodaje
(23.8.) to za jeden delší cross-session úkol reálně vygenerovalo 10 zpráv, místy i
nekonzistentně v angličtině, protože nejde o promyšlené zprávy pro uživatele, ale
nahlas psané pracovní myšlenky. Konvence proto teď je (viz `personal/zpravodaj/CLAUDE.md`,
`personal/mailista/CLAUDE.md`, sekce "Cross-session zprávy od assistenta"): jedna
nemarkovaná úvodní zpráva, pak `[TICHO]` na všechno mezi tím, a nemarkovaný finální
výsledek (případně eskalace kdykoliv uprostřed).

## 2. Struktura jednoho bota (šablona pro založení dalšího)

Každý bot = vlastní adresář `personal/<jméno>/`:
- `bridge-ts` proces spuštěný s profilem daného bota, `cwd` = tenhle adresář
- vlastní Telegram token v `/home/agent/agent-system/.env.<jméno>`, tamtéž volitelně
  `CLAUDE_MODEL` (viz §2a) — bez něj default `sonnet`
- `CLAUDE.md` — trvalé instrukce, načte se automaticky při každém tahu (viz §3,
  všechny konvence musí být TADY, ne jen v hlavě zakladatele)
- `DECISIONS.md` — technická/architektonická rozhodnutí specifická pro bota, formát
  Decision/Why/Alternatives/Date
- `TASKS.md` — rozpracované/otevřené úkoly, aby přežily i prázdnou `chat_history.txt`
- `session_id.txt`, `chat_history.txt`, `inbox/`, `heartbeat_ts.txt`,
  `job_queue_ts.json`, `outbox_ts.json`, `turn_log_ts.jsonl` — provozní stav,
  vytváří/udržuje `bridge-ts` sám
- záznam v `watchdog.sh` (host-level cron skript, mimo `personal/`) — bez něj bota
  nikdo nenahodí po pádu

**První nastartování procesu** (incident 7.9., zakládání `devops`): uvnitř sandboxované
agent session ručně spuštěný proces (`nohup ... &`, `disown`, i Bash tool
`run_in_background: true`) **nepřežije konec/teardown té session** — sandbox zabíjí
celou skupinu procesů, i když vypadají jako odpojené. Nespoléhat na to, že ruční start
zůstane naživu. Bezpečný postup: (1) přidat řádek do `watchdog.sh` JEŠTĚ PŘED prvním
startem, (2) ověřit, že systémový `crontab -l` opravdu obsahuje `* * * * * .../watchdog.sh`
(mělo by, ale ověřit), (3) proces klidně spustit ručně na test (ověří se token/`.env`),
ale počítat s tím, že po skončení téhle session ho nejpozději do minuty znovu nahodí
cron watchdog — to je ten mechanismus, který drží všechny ostatní boty naživu napříč
sessions, ne ruční `nohup`.

**Stejná past u `Agent` toolu s `run_in_background: true`** (incident 7.9., `devops`):
každá příchozí Telegram zpráva spouští u `bridge-ts` bota novou `claude` invokaci
(`--resume <session_id>`), ne jeden nekonečně běžící proces — konverzace přežívá
díky `session_id.txt`, ale sandboxovaná skupina procesů dané invokace skončí, jakmile
ten tah dokončí odpověď. Subagent zadaný přes `Agent` s `run_in_background: true`
(čekání na notifikaci "až bude hotovo") běží ve stejné skupině procesů jako hlavní
tah, takže když bot pošle uživateli mezitýmní zprávu a tah skončí, subagent zemře
tiše s ním — žádná notifikace nikdy nedorazí, žádná chyba se nezaloguje. Bezpečný
postup pro delší analýzu/vývoj v `bridge-ts` botovi: spustit ji **synchronně**
(`run_in_background: false`) v rámci jednoho tahu, i za cenu delšího čekání na
odpověď, ne spoléhat na to, že dýchá dál mezi Telegram zprávami.

**Výjimka pro dedikované vývojové boty** (první příklad: `fbalbums`, 27.8.): pokud bot
vyvíjí vlastní produkt (appku), samotný kód produktu **nepatří do `personal/<jméno>/`
ani do `agent-system` repa vůbec** — jde do vlastního odděleného adresáře/git repa
(u fbalbums `/home/agent/fbalbums`, lokální, zatím bez GitHub remote), protože má jiné
secrets, jinou expozici a jinou životnost než `agent-system`. `personal/<jméno>/` u
takového bota zůstává jen jeho provozní domov (instrukce, stav, Telegram) — worktree
izolace pro jednotlivé iterace (`EnterWorktree`/`ExitWorktree`) se otvírá nad tím
odděleným produktovým repem, ne nad `agent-system`.

**Výjimka opačným směrem** (`devops`, 7.9.): dedikovaný bot na interní vývoj/infra
*samotného* `agent-system` pracuje přímo nad `agent-system` repem — žádný oddělený
produktový repo tu nedává smysl, protože `agent-system` JE ten produkt, který
udržuje. Worktree izolace pro jeho iterace se tedy otvírá nad `/home/agent/agent-system`
samotným, ne nad odděleným adresářem — na rozdíl od `fbalbums` výš. Riziko je vyšší
(sahá na repo, ze kterého běží živě zbytek produkčního provozu), proto má navíc
nízkou autonomii pro cokoliv, co by restartovalo/zastavilo proces jiného bota nebo
zasáhlo do sdíleného crontabu (viz `personal/devops/CLAUDE.md`).

## 2a. Přiřazování modelu botovi/subagentovi

Statický `--model` flag per bot proces (`bridge-ts/src/claudeProcess.ts` čte
`CLAUDE_MODEL` z `.env.<jméno>`, default `sonnet`) — žádné dynamické přepínání
podle úkolu uvnitř jednoho bota, stejný vzor, jaký používá Ludwigův bridge.
Pravidlo pro volbu při zakládání bota:
- **`sonnet` (default)** — běžný bot s průběžnou konverzací/rozhodováním
  (assistant, zpravodaj, mailista, joby, nakup, fbalbums, devops, budoucí
  finanční/jazykový bot).
  Neměnit bez konkrétního důvodu (kvalita rozhodování u citlivých úkolů, např.
  mailista maže/archivuje maily, jde o data).
- **`opus`** — jen tam, kde jde primárně o hloubku/kvalitu jednorázového
  výstupu, ne o levný objem (např. dedikovaný deep-research bot).
- **`haiku`** — zvážit jen u vysokoobjemové, nízkorizikové, opakovatelné
  klasifikace (ne u rozhodnutí, která se těžko vrací zpět). Přepnutí existujícího
  bota na `haiku` kvůli úspoře tokenů je změna chování/kvality, ne jen infra —
  potvrdit s uživatelem předem, nepřepínat automaticky.
- Subagenti spuštění přes `Agent` tool (uvnitř jednoho bota) mají svůj vlastní
  `model` parametr na úrovni jednoho volání — to je nezávislé na `CLAUDE_MODEL`
  bota a řeší se výběrem modelu pro konkrétní subagentní úkol, ne globálně.

## 3. Konvence, které musí mít KAŽDÝ nový bot v `CLAUDE.md` (vynucené incidenty, ne teorie)

1. **Jazyk** — úplně všechno směrem k uživateli (Telegram) i mezi boty (`SendMessage`)
   je vždy česky, včetně technických poznámek a průběžných zpráv. Chybělo to
   explicitně u všech tří botů, jednou to sklouzlo do angličtiny (zpravodaj) — teď je
   to explicitní pravidlo, ne nepsaná konvence.
2. **Delegační protokol** (§1) — 📥/⏳ do vlastního chatu na začátku, výsledek do
   vlastního chatu na konci; `SendMessage` zpátky assistentovi jen když bot
   potřebuje jeho reakci (dotaz/blokující problém), NE jako rutinní potvrzení
   přijetí nebo dokončení. Platí obousměrně.
3. **Skripty mimo `bridge-ts`** (cron, přímé `claude -p` z bashe) jsou neviditelné
   pro `ListAgents`/dashboard/`job_queue_ts.json` — jediná stopa je jejich vlastní
   log. Musí při chybě aktivně poslat upozornění (Telegram/`SendMessage`), ne jen
   zapsat řádku do logu. Bez tohohle pravidla `ai_news_digest.sh` jednou spadl beze
   stopy a našlo se to jen ručním čtením logu.
4. **Nízká autonomie** pro mazání dat, peníze, produkční nasazení, bezpečnostní
   nastavení — vyžaduje explicitní schválení uživatele. Vysoká pro research/analýzu/
   návrhy/lokální úpravy.
5. **Trvalá opakovaná úloha (denně/týdně, napořád) jde přes systémový crontab +
   samostatný shell skript, NIKDY jen přes `CronCreate`** (incident 24.–25.8., joby).
   `CronCreate` žije jen v paměti běžícího `bridge-ts` procesu dané session — zmizí
   beze stopy a beze chyby při jakémkoli restartu procesu (watchdog po pádu, rate
   limit, proaktivní cyklení kontextu při `CONTEXT_CYCLE_THRESHOLD_TOKENS`, viz
   `bridge-ts/src/config.ts`). Bot, co si tak naplánuje "denně v 8:00 hledej
   nabídky", přestane hlásit potichu — nevypadá to jako selhání, vypadá to jako
   "dnes nic nenašel". Joby přesně tohle udělalo (test 24.8. nastavil `CronCreate` na denní
   hledání, druhý den nic nepřišlo, protože mezitím proces restartoval), a samo si
   to za pomoct s uživatelem diagnostikovalo. Durable vzor je zpravodajův:
   samostatný skript (`daily_digest.sh`, `ai_news_digest.sh`) nezávislý na
   `bridge-ts`/Claude session, spuštěný ze **systémového** `crontab` (`crontab -e`,
   ne `CronCreate`), který si sám zavolá `claude -p` a pošle výsledek. Protože jde o
   sdílený systémový crontab (§4), přidání řádku je změna, kterou si bot musí
   nechat schválit uživatelem předem (nízká autonomie), ne založit sám.
   `CronCreate` zůstává v pořádku jen pro krátkodobé probouzení uvnitř JEDNOHO
   aktivního běhu, co se odehraje a skončí v řádu hodin (mailista, noční dávková
   smyčka, viz §1) — ne pro cokoliv, co má přežít přes den/restart.

## 4. Sdílené vs. izolované zdroje mezi boty

Izolované (per-bot, žádné sdílení): Telegram token, `session_id.txt`,
`chat_history.txt`, `inbox/`, `heartbeat_ts.txt`, `job_queue_ts.json`,
`outbox_ts.json`, `turn_log_ts.jsonl`, `CLAUDE.md`/`DECISIONS.md`/`TASKS.md`.

Sdílené (a tedy citlivé — chyba tady zasáhne víc botů najednou):
- **Systémový crontab** (`watchdog.sh` pro všechny procesy).
- **Samotné `bridge-ts` procesy** — ukázalo se to incidentem 18.8., kdy zpravodaj v
  nouzi ručně restartoval "hlavního bota" (assistant) mimo `watchdog.sh` (bez `cd`,
  bez profilového argumentu) a vytvořil duplicitní proces, který kolidoval s tím, co
  mezitím nahodil cron — zmatek se přelil na všechny tři boty. Poučení: restart
  cizího bota vždy přes `watchdog.sh` postup, nikdy ručním `tsx src/index.ts`.
- **Jeden Claude Pro účet** (5h kvóta sdílená napříč všemi boty) — dashboard proto
  sčítá spotřebu přes všechny boty dohromady, ne per-bot izolovaně.
- **Server samotný, 3.7GB RAM** — build/dev cyklus (node_modules, TS kompilace, dev
  server běžící trvale) je reálné OOM riziko, ne teoretické — zpravodajova webovka
  takhle jednou spadla. Nové appky/web tooling v tomhle projektu: JS/TS/Node/React
  (uživatelův preferovaný stack, aby si to uměl sám odladit), ale s vědomím, že
  paměť je tenký zdroj — vyhýbat se trvale běžícím těžkým dev-serverům, kde to jde.

## 4a. Docker pilot — denní boti (od 7.9., `personal/devops`)

Cíl: místo kontejneru pro každého ze 6 botů (moc overheadu na těsné paměti) 2
kontejnery podle rizikového profilu — stabilní denní boti (assistant, zpravodaj,
mailista, joby, nakup) v jednom, aktivně vyvíjené projektové boty (fbalbums a
budoucí produkty) v druhém. `devops` (tenhle bot) zůstává na hostu mimo kontejnery,
protože potřebuje přístup k dockeru/crontabu/watchdogu napříč strojem.

Iterace 1 (v repu jako `Dockerfile.daily` / `docker-compose.daily.yml` /
`start-daily.sh` v kořeni repa): obraz + compose pro skupinu denních botů, jen
ověření mechaniky (build, start 5 `tsx src/index.ts <profil>` procesů v jednom
kontejneru, čitelnost `heartbeat_ts.txt` přes volume mount). Absolutní cesty
uvnitř kontejneru zrcadlí hostitelské (`/home/agent/agent-system/...`), takže
`.env.<profil>` (`BOT_DIR` apod.) fungují beze změny kódu a stavové soubory zůstávají
ve stejném formátu jako na hostu. Kontejner běží pod `user: "1000:1000"` (stejné
uid/gid jako hostitelský `agent`), jinak by soubory zapsané bridge-ts do
bind-mountnutých `personal/<profil>` adresářů skončily na hostu vlastněné rootem.
`bridge_ts_<profil>_claude_stderr.log` (na rozdíl od heartbeatu) přes volume mount
zatím čitelný NENÍ — zůstává jen uvnitř kontejneru a mizí s `docker compose down`
(viz iterace 2 níž, `chown` řeší jen zápis, ne trvalou viditelnost na hostu).

Iterace 2 (stejné soubory): `claude` CLI uvnitř kontejneru. `Dockerfile.daily`
instaluje `@anthropic-ai/claude-code` globálně přes npm, verze připnutá na
shodu s hostem (ruční bump při aktualizaci hostitelského CLI) — bez CLI bridge-ts
padal na `ENOENT` (`spawn("claude", ...)` v `claudeProcess.ts`). Autentizace jde
přes read-only bind mount hostitelských `~/.claude/.credentials.json` a
`~/.claude.json` (cesta natvrdo, ne `${HOME}`, ať se nerozbije při pozdějším
spouštění mimo interaktivní shell) + `HOME=/home/agent` v prostředí kontejneru,
stejný token jako host používá živě — čte ho stejné uid (1000), takže žádná
změna oprávnění na hostu. `Dockerfile.daily` navíc chowne
`/home/agent/agent-system` na `1000:1000`, jinak zápis
`bridge_ts_<profil>_claude_stderr.log` (mimo bind-mountnuté `personal/<profil>`)
padal na `EACCES` pod non-root userem. Ověřeno buildem + testem s fiktivními
Telegram tokeny, ale reálnými CLI credentials — `claude -p` i všech 5 profilů
bridge-ts nastartuje `claude` subprocess bez ENOENT/EACCES.

Iterace 3 (stejné soubory, jen `docker-compose.daily.yml`): bind mount
`META_BOT.md` a `ARCHITEKTURA.md` (kořen repa) do kontejneru na stejnou cestu,
**read-only**. Původní záměr byl read-write (`personal/assistant/CLAUDE.md`
ukládá assistentovi tyhle dokumenty při architektonických změnách i
zapisovat), ale code review + přímé ověření (test inode před/po `Edit`
nástroji) potvrdily, že to nejde bezpečně: `Edit` nepíše in-place, ale přes
tmp-soubor+rename, takže výsledek skončí na novém inode, který bind mount
jednotlivého souboru vůbec nevidí (mount je vázaný na inode zachycený při
startu kontejneru, ne na cestu) — zápis by se tiše ztratil, nepropsal by se
na host. Proto zůstává mount jen ke čtení, dokud nevznikne adresářový mount
(stejný vzor jako `personal/<profil>`), který tenhle problém neřeší jen
částečně, ale strukturálně — otevřená položka v `TASKS.md`.

Stejný inode-limit i na straně hostu: pokud host nahradí `META_BOT.md`/
`ARCHITEKTURA.md` operací, co vytváří nový inode (merge, checkout, rebase —
přesně to, co dělá krok 5 vývojového cyklu při mergi do `main`), běžící
kontejner uvidí zastaralý obsah, dokud se nerestartuje. Bez dopadu dnes (žádný
kontejner neběží souběžně s produkčním provozem) — a na rozdíl od
kontejnerového zápisu výše tohle budoucí adresářový mount (`TASKS.md`) sám od
sebe vyřeší (mount vázaný na adresář, ne na konkrétní soubor, vidí živý obsah
adresáře při každém přístupu).

Záměrně MIMO rozsah iterací 1–3 (viz `personal/devops/CLAUDE.md`): napojení na
`watchdog.sh`/systémový crontab, migrace živého provozu (kontejner se nepouští
souběžně s hostem na produkčních tokenech — kolidoval by se stejným Telegram
`getUpdates` long-pollem), mount celého `~/.claude` (jen vybrané 2 soubory, ne
`settings.json`/`projects/`/atd. — jednodušší, ale při budoucí divergenci
CLI configu na hostu se to do kontejneru nepropíše). Boti nadále běží na hostu
jako dřív, dokud se explicitně neschválí migrace v pozdější iteraci.

Nesouvisí s tímhle: starší nepoužívaný prototyp `Dockerfile` / `docker-compose.yml` /
`app.py` v kořeni repa (echo bot z 16.8., viz `personal/assistant/DECISIONS.md`,
17.8.) — zůstává ležet beze změny, otázka smazat/nahradit je pořád otevřená.

## 5. Otevřené otázky (zatím nerozhodnuto, viz `personal/assistant/DECISIONS.md`, 17.8.)

1. Aktivní monitoring/alerting napříč víc agenty najednou (dnes se řeší jen ručním
   dotazem/čtením souborů druhého bota, funguje to jen protože všichni boti běží pod
   stejným userem na stejném serveru).
2. Sandboxing/omezení přístupu bota do zbytku serveru — zatím zbytečná komplexita
   (boty píše/spouští člověk), ale jakmile bude existovat meta-bot generující kód pro
   nové boty sám, bez lidského review, riziko se mění a izolace začne dávat smysl.

## 6. Kam se dívat pro detaily

Plný popis incidentů a jejich oprav (rate limit handling, race condition v
`ClaudeProcess`, timeout/zombie proces, proaktivní cyklení kontextu, dashboard) je v
`personal/assistant/DECISIONS.md` — tenhle soubor je destilát pro rychlou orientaci,
ne náhrada.
