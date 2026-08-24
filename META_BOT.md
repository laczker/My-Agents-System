# Poznámky pro budoucího meta-bota (bota, co zakládá další boty)

> Doplňuje `ARCHITEKTURA.md` (sekce 10 „Orchestrator“, sekce 13 „Persistent context“).
> Tam je původní záměr/vize, tady je **jak systém reálně funguje ke dni 2026-08-19**
> a jaké konvence si tři dosavadní boti (assistant, zpravodaj, mailista) postupně
> vynutily provozem. Až vznikne bot, který bude sám zakládat a spouštět další boty,
> má tenhle soubor přečíst jako první — ušetří to znovuobjevování stejných pravidel
> přes stejné incidenty.

## 1. Jak to vypadá dnes — diagram

```
                    Uživatel (Telegram, 4 samostatné boty)
              @Assistant   @Zpravodaj   @Mailista   @HlidacJobu
                    │            │            │            │
              ┌─────▼─────┐┌────▼──────┐┌────▼──────┐┌────▼──────┐
              │ bridge-ts ││ bridge-ts ││ bridge-ts ││ bridge-ts │
              │(assistant)││(zpravodaj)││(mailista) ││  (joby)   │
              │cwd=personal││cwd=personal││cwd=personal││cwd=personal│
              │/assistant/ ││/zpravodaj/ ││/mailista/  ││ /joby/     │
              └─────┬─────┘└─────┬─────┘└─────┬─────┘└─────┬─────┘
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
    hlídá heartbeat/pgrep 5 procesů: assistant, zpravodaj, mailista, joby, dashboard
    → restartuje spadlý/zaseknutý, zapisuje důvod do dashboard.sqlite

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

## 2a. Přiřazování modelu botovi/subagentovi

Statický `--model` flag per bot proces (`bridge-ts/src/claudeProcess.ts` čte
`CLAUDE_MODEL` z `.env.<jméno>`, default `sonnet`) — žádné dynamické přepínání
podle úkolu uvnitř jednoho bota, stejný vzor, jaký používá Ludwigův bridge.
Pravidlo pro volbu při zakládání bota:
- **`sonnet` (default)** — běžný bot s průběžnou konverzací/rozhodováním
  (assistant, zpravodaj, mailista, joby, budoucí programátor/finanční/jazykový bot).
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
