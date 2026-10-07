# Poznámky pro budoucího meta-bota (bota, co zakládá další boty)

> Doplňuje `ARCHITEKTURA.md` (sekce 10 „Orchestrator”, sekce 13 „Persistent context”).
> Tam je původní záměr/vize, tady je **jak systém reálně funguje ke dni 2026-09-22**
> a jaké konvence si dosavadní boti (assistant, zpravodaj, mailista, joby, nakup,
> fbalbums, devbot, trenér) postupně vynutily provozem. Až vznikne bot, který bude sám zakládat a
> spouštět další boty, má tenhle soubor přečíst jako první — ušetří to
> znovuobjevování stejných pravidel přes stejné incidenty.

## 1. Jak to vypadá dnes — diagram

```
                    Uživatel (Telegram, 8 samostatných botů)
      @Assistant   @Zpravodaj   @Mailista   @HlidacJobu   @Nákup   @FbAlbums   @DevBot   @Trenér
            │            │            │            │          │         │         │         │
      ┌─────▼─────┐┌────▼──────┐┌────▼──────┐┌────▼──────┐┌──▼────────┐┌─▼─────────┐┌─▼─────────┐┌─▼─────────┐
      │ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts │
      │(assistant)││(zpravodaj)││(mailista) ││  (joby)   ││  (nakup)  ││ (fbalbums)││ (devbot)  ││ (trener)  │
      │cwd=personal││cwd=personal││cwd=personal││cwd=personal││cwd=personal││cwd=personal││cwd=personal││cwd=personal│
      │/assistant/ ││/zpravodaj/ ││/mailista/  ││ /joby/     ││ /nakup/    ││ /fbalbums/ ││ /devbot/   ││ /trener/   │
      └─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘
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
    hlídá heartbeat/pgrep 9 procesů: assistant, zpravodaj, mailista, joby, nakup,
    fbalbums, devbot, trener, dashboard → restartuje spadlý/zaseknutý, zapisuje důvod do dashboard.sqlite

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

**Zápis unsolicited tahu do `chat_history.txt`** (incident 21.9., devbot): do 21.9.
`handleUnsolicitedLine` posílal finální text (`obj.type === "result"`, ne mlčený
`SILENT_MARKER`em) jen živě do Telegramu (`broadcastMsg`/`onUnsolicitedText`), nikdy ho
nezapsal přes `appendHistory()` — po pozdějším proaktivním cyklení kontextu
(`CONTEXT_CYCLE_THRESHOLD_TOKENS`, nový proces se seeduje jen z `chat_history.txt`) o
takovém tahu agent nevěděl vůbec nic, i když ho uživatel viděl v Telegramu. U devbota se
takhle ztratil celý schválený spec. Od 21.9. `handleUnsolicitedLine` zapisuje finální
(ne streamované mezikroky) text KAŽDÉHO nemlčeného unsolicited tahu do
`chat_history.txt` s neutrálním popiskem `[cross-session/background událost]`, nezávisle
na Telegram broadcastu — zápis běží v `try/catch`, ať jeho případné selhání (ENOSPC apod.)
neshodí Telegram broadcast ani reset dedup stavu. `logTurn`/`turn_log_ts.jsonl` beze
změny (tenhle tah nemá `usage` data z `runClaude`). Platí pro všech 7 profilů stejně,
protože jde o sdílený kód `bridge-ts`.

`history.ts` odděluje výměny v `chat_history.txt` doslovným řetězcem `"---\n"` —
kolizí s markdownovou horizontální linkou (běžnou v Markdown-formátovaném textu,
který teď zapisuje i výše popsaný unsolicited zápis) by se jedna výměna rozsekla
na víc nelabelovaných fragmentů. `appendHistory()` proto před zápisem takovou
kolizi escapuje (neviditelný zero-width space hned za `---`), `getHistory()` ho
při čtení zase odstraňuje — pokud budeš `chat_history.txt` někdy prohlížet/grepovat
přímo (ne přes `getHistory()`), počítej s tím, že soubor na disku obsahuje
neviditelné znaky navíc kolem `---` uvnitř textu výměn.

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

**První nastartování procesu** (incident 7.9., zakládání `devbot`): uvnitř sandboxované
agent session ručně spuštěný proces (`nohup ... &`, `disown`, i Bash tool
`run_in_background: true`) **nepřežije konec/teardown té session** — sandbox zabíjí
celou skupinu procesů, i když vypadají jako odpojené. Nespoléhat na to, že ruční start
zůstane naživu. Bezpečný postup: (1) přidat řádek do `watchdog.sh` JEŠTĚ PŘED prvním
startem, (2) ověřit, že systémový `crontab -l` opravdu obsahuje `* * * * * .../watchdog.sh`
(mělo by, ale ověřit), (3) proces klidně spustit ručně na test (ověří se token/`.env`),
ale počítat s tím, že po skončení téhle session ho nejpozději do minuty znovu nahodí
cron watchdog — to je ten mechanismus, který drží všechny ostatní boty naživu napříč
sessions, ne ruční `nohup`.

Potvrzeno znovu při zakládání `trener` (22.9.): přesně tohle se stalo — ruční `nohup`
test zemřel s koncem session, watchdog do minuty nahodil nový proces. Během téhle
výměny (starý proces ještě dobíhá/umírá, nový už zkouší `getUpdates`) grammY krátce
hlásí `409 Conflict: terminated by other getUpdates request` a retry backoff
(2s/4s/8s/16s/30s) — to je OČEKÁVANÝ, neškodný vedlejší efekt handoffu, ne chyba k
řešení. Pokud po pár desítkách sekund přibude čerstvý `heartbeat_ts.txt` bez dalšího
konfliktu v logu, bot je v pořádku a nic se nemusí zasahovat ručně.

**Stejná past u `Agent` toolu s `run_in_background: true`** (incident 7.9., `devbot`):
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

**Výjimka opačným směrem** (`devbot`, 7.9.): dedikovaný bot na interní vývoj/infra
*samotného* `agent-system` pracuje přímo nad `agent-system` repem — žádný oddělený
produktový repo tu nedává smysl, protože `agent-system` JE ten produkt, který
udržuje. Worktree izolace pro jeho iterace se tedy otvírá nad `/home/agent/agent-system`
samotným, ne nad odděleným adresářem — na rozdíl od `fbalbums` výš. Riziko je vyšší
(sahá na repo, ze kterého běží živě zbytek produkčního provozu), proto má navíc
nízkou autonomii pro cokoliv, co by restartovalo/zastavilo proces jiného bota nebo
zasáhlo do sdíleného crontabu (viz `personal/devbot/CLAUDE.md`).

## 2a. Přiřazování modelu botovi/subagentovi

Statický `--model` flag per bot proces (`bridge-ts/src/claudeProcess.ts` čte
`CLAUDE_MODEL` z `.env.<jméno>`, default `sonnet`) — žádné dynamické přepínání
podle úkolu uvnitř jednoho bota, stejný vzor, jaký používá Ludwigův bridge.
Pravidlo pro volbu při zakládání bota:
- **`sonnet` (default)** — běžný bot s průběžnou konverzací/rozhodováním
  (assistant, zpravodaj, mailista, joby, nakup, fbalbums, devbot, trener,
  budoucí finanční/jazykový bot).
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
  sčítá spotřebu přes všechny boty dohromady, ne per-bot izolovaně. `bridge-ts`
  (sdílený kód, všech 7 profilů) kromě potvrzeného `rate_limit_event` teď umí i
  odhadnout vyčerpanou kvótu z opakovaného selhání bez čisté odpovědi (timeout/pád
  procesu dvakrát za sebou) a napojit se na stejný čekací mechanismus — se stropem
  24h, pak se úkol zahodí a uživatel je vyzván napsat znovu. Detaily a otevřené
  otázky (blast radius napříč chaty) v `personal/devbot/DECISIONS.md`.
- **Server samotný, 3.7GB RAM** — build/dev cyklus (node_modules, TS kompilace, dev
  server běžící trvale) je reálné OOM riziko, ne teoretické — zpravodajova webovka
  takhle jednou spadla. Nové appky/web tooling v tomhle projektu: JS/TS/Node/React
  (uživatelův preferovaný stack, aby si to uměl sám odladit), ale s vědomím, že
  paměť je tenký zdroj — vyhýbat se trvale běžícím těžkým dev-serverům, kde to jde.

## 4a. Docker pilot — denní boti (od 7.9., `personal/devbot`)

Cíl: místo kontejneru pro každého ze 6 botů (moc overheadu na těsné paměti) 2
kontejnery podle rizikového profilu — stabilní denní boti (assistant, zpravodaj,
mailista, joby, nakup) v jednom, aktivně vyvíjené projektové boty (fbalbums a
budoucí produkty) v druhém. `devbot` (tenhle bot) zůstává na hostu mimo kontejnery,
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

Iterace 3 -> iterace 13: `META_BOT.md` a `ARCHITEKTURA.md` žijí v adresáři
`docs/` v kořeni repa a do kontejnerů se mountuje celý adresář `./docs` →
`/home/agent/agent-system/docs`: **read-write** v denní skupině (assistent
tyhle dokumenty podle `personal/assistant/CLAUDE.md` při architektonických
změnách upravuje), **read-only** v projektové (jen čtou). Původní mount
jednotlivých souborů (iterace 3, jen `:ro`) nešel: `Edit` píše přes
tmp-soubor+rename, takže výsledek skončí na novém inode, který file bind mount
nevidí, a stejně tak host (merge/checkout/rebase) nechával kontejner se
zastaralým obsahem. Adresářový mount vidí živý obsah adresáře vždy. Nasazení:
`docker compose up -d` (recreate) obou skupin — schvaluje se v checkpointu.

Iterace 4 (`watchdog.sh`): přidána schopnost zjistit, jestli kontejner
`daily-bots` běží (`docker compose -f docker-compose.daily.yml ps --status
running --services`), a pokud ne, restartovat ho (`docker compose ... up -d`)
+ zalogovat přes `record_restart`, stejnou konvencí jako dnešní `pgrep`/`nohup`
bloky pro holé procesy. Detekce ověřena reálným testem (kontejner nastartovaný
s náhradním `sleep infinity` příkazem místo `bridge-ts`, aby test nezávisel na
platných Telegram tokenech — viz iterace 1–2 výše, funkční start s fiktivními
tokeny end-to-end zatím ověřen nebyl, `grammy` na neplatném tokenu skončí
chybou a kontejner spadne). Kód je **záměrně zakomentovaný**, ne zapojený do
minutového cronu: dokud hostové `pgrep`/`nohup` bloky pro denní boty běží dál
(cutover ještě neproběhl), by automatický `up -d` mohl kontejner nastartovat
se skutečnými tokeny souběžně s hostovým procesem téhož bota → kolize stejného
Telegram `getUpdates` long-pollu. Aktivace (odkomentovat + zároveň vypnout
odpovídající hostové bloky) je otevřená položka, viz `personal/devbot/TASKS.md`.

Záměrně MIMO rozsah iterací 1–4 (viz `personal/devbot/CLAUDE.md`): migrace
živého provozu (kontejner se nepouští souběžně s hostem na produkčních
tokenech — kolidoval by se stejným Telegram `getUpdates` long-pollem), mount
celého `~/.claude` (jen vybrané 2 soubory, ne `settings.json`/`projects/`/atd.
— jednodušší, ale při budoucí divergenci CLI configu na hostu se to do
kontejneru nepropíše). Boti nadále běží na hostu jako dřív, dokud se explicitně
neschválí migrace v pozdější iteraci.

Iterace 5 (v repu jako `Dockerfile.project` / `docker-compose.project.yml` /
`start-project.sh` v kořeni repa, zatím jen `fbalbums`): obraz + compose pro
skupinu projektových botů, mirror iterací 1–2 denní skupiny (stejný
`user: "1000:1000"`, stejný `.credentials.json`/`.claude.json` read-only mount,
stejný `chown` kvůli `EACCES` na stderr log mimo bind-mount). Dvě odlišnosti
oproti denní skupině: `Dockerfile.project` instaluje `git` (`apt-get install`),
protože fbalbums si uvnitř otevírá `git worktree` přes `EnterWorktree`/
`ExitWorktree` nad vlastním produktovým repem — bez CLI by ten krok hned
selhal; a produktový repo (`/home/agent/fbalbums`) je mountnutý
**read-write** (na rozdíl od denní skupiny, kde je mimo `personal/<profil>`
všechno jen read-only), protože worktree cyklus potřebuje do repa zapisovat.
Ověřeno jen buildem + ověřením, že `git`/`node` binárky v obrazu existují —
ne startem s reálným Telegram tokenem/mounty (ten test by kolidoval s
hostovým fbalbums procesem běžícím naživo, stejný `getUpdates` konflikt jako
u denní skupiny, viz níž) ani plným `git worktree` cyklem uvnitř kontejneru.

Záměrně MIMO rozsah iterace 5 (stejně jako iterací 1–2 denní skupiny):
napojení na `watchdog.sh`/crontab, migrace živého provozu, Google Drive MCP
konektor (fbalbums ho používá na fotky) uvnitř kontejneru.

Nesouvisí s tímhle: starší nepoužívaný prototyp `Dockerfile` / `docker-compose.yml` /
`app.py` v kořeni repa (echo bot z 16.8., viz `personal/assistant/DECISIONS.md`,
17.8.) — zůstává ležet beze změny, otázka smazat/nahradit je pořád otevřená.

Iterace 6 (canary cutover `nakup`, 5.10.): první skutečná migrace živého
provozu z hostu do `daily-bots` kontejneru — dřív jen ověřená mechanika, teď
prod. `nakup` zvolen jako první, protože je jediný z denní skupiny bez
vlastního samostatného cron skriptu na hostu (na rozdíl od joby/mailista/
zpravodaj/trenér), tedy nejnižší riziko kolize stavových souborů mezi hostem
a kontejnerem. `docker-compose.daily.yml` dostal `DAILY_PROFILES=nakup`
(`start-daily.sh` teď čte `$DAILY_PROFILES`, default beze změny = všech 5),
takže kontejner pro tuhle iteraci startuje jen `nakup`, ne celou denní
skupinu — zbylé 4 profily běží dál na hostu nedotčené.

`watchdog.sh` hostový `pgrep`/`nohup` blok pro `nakup` nahrazen
kontejnerovou verzí (dvoukrokově: `docker compose ps` na kontejner samotný,
pak `exec` pgrep na konkrétní proces uvnitř — zachytí i pád procesu, co
`start-daily.sh`/`wait` sám nevyhodí). Iterace 4 výš popisovala tenhle
mechanismus jen jako zakomentovaný/neaktivní pro celou skupinu; teď je
aktivní v minutovém cronu, ale jen pro `nakup`. Dashboard (`personal/
dashboard/src/config.ts`, pole `inContainer`) restart tlačítko pro `nakup`
teď taky jde přes `docker compose exec ... pkill`, ne hostový `pkill` — jinak
by proti kontejnerové PID namespace neměl na co sáhnout a tiše by no-opnul.

Iterace 7 (cutover `assistant`, 7.10.): stejný vzor jako iterace 6, druhý
profil. `assistant` zvolen jako další, protože je — stejně jako `nakup` —
bez vlastního samostatného cron skriptu na hostu. `DAILY_PROFILES` teď
`nakup assistant`, `watchdog.sh` kontejnerová kontrola generalizovaná na oba
profily (force-recreate kontejneru, pokud kterýkoliv z nich uvnitř neběží;
hostový `pgrep`/`nohup` blok pro `assistant` smazán). Dashboard config dostal
`inContainer: true` i pro `assistant` ze stejného důvodu jako u `nakup`
(iterace 6) — jinak by restart tlačítko tiše no-opnulo proti prázdné hostové
PID namespace.

**Iterace 8 (6.10.) — dokončení převodu:** zpravodaj, mailista a joby přešly do
`daily-bots` (`DAILY_PROFILES` smazáno, všech 5 profilů v kontejneru) a `fbalbums`
do `project-bots` (`docker-compose.project.yml`). `watchdog.sh` hlídá oba
kontejnery dvoukrokově (`compose ps` + `exec pgrep`), hostové `pgrep`/`nohup` bloky
pro tyhle profily jsou pryč; `inContainer` v dashboardu je teď `"daily-bots"` /
`"project-bots"` a restart tlačítko míří na správný compose soubor. `Dockerfile.project`
dostal `procps`. Na hostu zůstávají `devbot`, dashboard a zpravodaj webapp
(port 8766) a cron skripty (`daily_digest.sh`, `ai_news_digest.sh`, `daily_job_search.sh`,
`nightly_cleanup.sh`) — ty běží mimo bridge-ts.

**Iterace 9 (6.10.) — viditelnost session napříč hostem a kontejnery:** `ListAgents`/
`SendMessage` hledají živé session v `~/.claude/sessions/<pid>.json` (s `pidDomain`)
a socket každé session v `/tmp/cc-socks`. Kontejnery to dřív nesdílely, takže se boti
v kontejneru nevídali ani mezi sebou ani s hostem (`devbot`). Oba compose soubory proto
mají `pid: host` a rw adresářové mounty `~/.claude/sessions` a `/tmp/cc-socks`. Ověřeno
jednorázovým kontejnerem ve `stream-json` režimu (`claude -p "text"` se do registru
nezapisuje); dosud jen směr host → kontejner.

**Iterace 10 — `trener` do `daily-bots`:** `trener` přešel z hostu do `daily-bots`
(6 profilů). Compose mountuje `.env.trener` (ro) a `personal/trener`, `start-daily.sh`
a `DAILY_PROFILES` ve `watchdog.sh` obsahují `trener`, hostový `pgrep`/`nohup` blok je
smazán (jinak by vznikly dva pollery na jednom tokenu, 409). `checkin.sh` (cron
13:00/23:00) zůstává na hostu. Pád jen `trener` restartuje celý `daily-bots` (stejně
jako u ostatních profilů). (Dashboard `trener` přidán v iteraci 12, viz níž.)

**Iterace 11 — `~/.claude` jako read-only adresářový mount:** single-file mount
`.credentials.json` držel po refreshi tokenu na hostu starý (expirovaný) soubor (tmp+rename
= nový inode) -> 401 v kontejneru. Oba compose soubory proto mountují celý
`/home/agent/.claude` jako `:ro` adresář (vždy aktuální obsah; kontejner token nikdy
neobnovuje, takže není race s hostem) a nad něj rw vnořený mount `~/.claude/sessions`
(registr z iterace 9). `~/.claude.json` zůstává single-file mount (viz TASKS.md devbota).

**Iterace 12 — limity paměti, pinnutý název projektu, jedna verze CLI:** (a) `mem_limit`:
`daily-bots` 1536m (naměřeno ~745 MiB, ~2x rezerva), `project-bots` 512m (naměřeno ~200 MiB);
limit omezí jeden vyběhlý profil, aby neshodil druhý kontejner ani hostové boty z ~3,7 GB RAM.
`restart` zůstává `"no"` — restartuje jedině `watchdog.sh` (docker-level policy by se s jeho
force-recreate prala). (b) `name: agent-system-daily` / `agent-system-project` + pinnutý
`container_name` (`agent-system-daily-bots-1`, `agent-system-project-bots-1`): oba soubory dřív sdílely
project name `agent-system`, takže `up` jednoho hlásil kontejner druhého jako orphan a
`--remove-orphans` by ho smazal. Názvy kontejnerů se nemění (nic na ně nereferuje podle
jména; `watchdog.sh` používá `-f` + název služby), ale změna project labelu znamená
jednorázový recreate: starý kontejner je nutné před `up -d` ručně odstranit (`docker rm -f`),
jinak `up` skončí konfliktem názvu. **Nikdy `--remove-orphans`.** (c) `ARG CLAUDE_CLI_VERSION`
v obou Dockerfilech (default = `claude --version` na hostu, 2.1.291) místo natvrdo
zapsaného pinu 2.1.280.

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
ne náhrada. Novější `bridge-ts` změny (OAuth fallback, Telegram UX, rate-limit
timeout fallback) se od založení `devbot` (7.9.) zapisují do
`personal/devbot/DECISIONS.md` místo sem.

> Note (iter. 12): dashboard now shows 7 bots (`trener` added to `BOTS` in `personal/dashboard/src/config.ts`). The daily-bots profile list lives in one file, `daily-profiles.txt` (repo root), read by `watchdog.sh`, `start-daily.sh` (via a ro mount `/daily-profiles.txt` in `docker-compose.daily.yml`) and the dashboard (sets `inContainer: "daily-bots"` at startup). Adding a daily bot = edit that file + `.env`/`personal/<bot>` mounts in compose + a `BOTS` entry. Rollout: restart the dashboard (reads the file at startup) and `up -d --build --force-recreate` for daily-bots (`start-daily.sh` changed, baked into the image).

> Note (iter. 10): `start-daily.sh` is baked into the daily image; after editing it run `up -d --build --force-recreate`.

> Note (iter. 11): `~/.claude` is now mounted as a whole directory, read-only, with `sessions/` as a nested rw mount, in both compose files (instead of single-file `.credentials.json` + `sessions/`). A token refresh on the host no longer leaves containers with a stale inode (401). Containers still cannot refresh the token themselves. Needs `up -d --force-recreate` to take effect. `~/.claude.json` is still a single-file ro mount (same inode caveat, not yet hit).

> Note (iter. 13): `watchdog.sh` staggers starts: at most `MAX_STARTS_PER_TICK` (2) starts per run (container up/recreate or host process: daily-bots, project-bots, devbot, dashboard, zpravodaj-webapp), `STAGGER_SECS` (15) sleep between consecutive starts; the rest is deferred to the next cron tick (logged as "deferred to next tick"). No deploy needed besides the file itself (cron runs it from the repo). `restart_remaining_profiles.sh` now matches the assistant with `" src/index\.ts$"` (leading space) so it no longer also matches the dashboard / zpravodaj webapp. Not staggered: the profiles inside one container (`start-daily.sh` still launches all at once).
