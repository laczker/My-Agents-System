# Úkoly — backlog

Průběžný seznam rozhodnutých/otevřených úkolů, aby se nemuselo spoléhat na
`chat_history.txt` (drží jen pár posledních výměn) ani na paměť v rámci jedné session.
Formát: stav, krátký popis, co blokuje. Hotové položky se mažou nebo přesouvají do
`DECISIONS.md`, pokud šlo o architektonické rozhodnutí.

## Čeká na uživatele

- **Finanční bot (research/rady) + dva učitelé — spec teď kompletní, čeká se
  na rozhodnutí o founding** (1.10., doplněno 3.10. a 5.10.) — navazuje na
  starý nápad "Finanční poradce bot" a "Učitel angličtiny bot" (oba 19.8.,
  jen název). Uživatel upřesnil:
  - **Finanční bot — rozdělení na dva boty potvrzeno uživatelem (3.10.)**
    kvůli principu "cokoliv s penězi = nízká autonomie, vždy explicitní
    schválení" (`CLAUDE.md`, "Principy"):
    1. **Research/rady bot** (vzniká jako první) — deep researche "co je
       teď dobrý" (investiční trendy/možnosti), rady na spoření, rady na
       projekty k rozjetí v rámci tohoto systému. Čistě informační, vysoká
       autonomie, žádné peníze v pohybu. **Doplněno 5.10.: poběží
       pravidelně** (jako zpravodajův digest), ne jen na vyžádání.
    2. **Trading bot** (odloženo, viz "Odloženo" níž) — AI autonomně
       obchoduje s malým kapitálem. Před založením deep research (subagent,
       3.10.) ověřil, jestli to v praxi reálně vydělává — výsledek a
       uživatelovo rozhodnutí "experimentovat se dá" viz položka v
       "Odloženo".
  - **Učitelé**: potvrzeno dva oddělené boti (AJ, programování). **Doplněno
    5.10.: kvízy se budou automaticky připomínat** (podobně jako research
    bot výše), ne jen na vyžádání. Aktuální úroveň uživatele u obojího (ať
    se bot nastaví na správnou obtížnost hned od začátku) se podle uživatele
    (1.10., potvrzeno znovu 5.10.) doladí až při zakládání každého bota, ne
    teď předem.
  **Spec na obě periodicity teď kompletní** — zbývá jen rozhodnutí, kdy/v
  jakém pořadí founding reálně spustit (viz návrh v chatu 5.10.: nejdřív
  research/rady bot, nebo všechny tři najednou). Založení podle šablony v
  `META_BOT.md` přijde, jakmile uživatel potvrdí start.


- **Deep analýza Ludwigova vzoru + návrhy vylepšení** (24.8.) — na žádost uživatele
  proběhla research analýza (subagent + ověření GitHub odkazů): Ludwigovy tři
  veřejné repo (`petrludwig-collab/Agent2Telegram`, `AgentsMonitoring`,
  `HumanAgentWiki`) potvrzeny jako reálné. Návrh na 7 vylepšení fáze "osobní
  život" (sdílený `notify` skript, SLA % na dashboardu, basic auth, sdílená
  sémantická paměť napříč boty, hlasové zprávy do botů, ověřit heartbeat
  vyhodnocení ve watchdogu, agregátní "system availability" karta) a 7 pro fázi
  "továrna na SW" (worktree izolace per úkol, automatizovaný code-review gate,
  testing/QA gate, cross-project orchestrátor, sandboxing per agent, sdílená
  wiki mezi vývojovými agenty, kanban pohled na dashboardu + CI gating). Čeká se,
  které z toho (pokud něco) uživatel chce reálně rozjet — zatím nic vybráno.
  **Doplněno 17.9.**: uživatel se ptal, jestli je současný flow "profi" a jestli
  by GitHub pomohl — ověřeno, `agent-system` je na GitHubu už od 17.–18.8.
  (`origin` → `laczker/My-Agents-System`), takže mezera není chybějící GitHub,
  ale přesně tahle nevybraná položka (branch/PR/review gate před mergem do main
  — dnes devbot commituje/pushuje rovnou). Deep research (subagent, websearch)
  navíc k Pro/Max/API limitům: headless `claude -p` volání (všech 7 botů) čerpají
  ze STEJNÉ sdílené Pro kvóty jako interaktivní chat, žádná oddělená kvóta pro
  automatizaci. Pro (~10–45 promptů/5h okno) je na 7 trvale běžících procesů +
  budoucí review gate hraniční/nedostatečné, Max 20x (~$200/měs) je reálný
  stopgap na předplatném, ale u produkčního fleetu dává větší smysl aspoň
  devbot/CI-review část přepnout na čisté API účtování s vlastním klíčem, ať to
  nesráží osobní kvótu. Čeká se na rozhodnutí uživatele: (a) který kus "factory"
  backlogu rozjet jako první (doporučeno: worktree + automatizovaný review gate
  v `bridge-ts`/devbot flow, ne celá GitHub Actions CI hned), (b) jestli/kdy
  přejít z Pro na Max nebo API klíč pro devbot provoz.
  **Doplněno 22.9.**: navazující diskuse o tom, jak "profi" AI factory na appky
  reálně vypadá (uživatel chce do budoucí delší appky zasahovat jen na konci
  iterace, ne furt odpovídat na drobnosti od devbota). Deep research (subagent,
  websearch) přes Devin/Cognition, Factory.ai Droids, GitHub Copilot Agent Mode,
  Anthropicův vlastní multi-agent research systém, ChatDev, MetaGPT: potvrzeno,
  že (a) "ptát se co nejmíň, přerušovat jen na pevných branách" je zdokumentovaná
  filozofie napříč těmito produkty — pokud devbot ping-uje mimo svoje dvě brány
  (schválení specu, finální checkpoint), je to chyba jeho ladění, ne důvod měnit
  architekturu; (b) agent-se-ptá-agenta místo člověka je reálný vzor (ChatDev
  dialog mezi rolemi, MetaGPT "Anything UNCLEAR" v dokumentu), ale evidence jen
  z akademických simulací, ne ostřílené produkce; (c) "designer" jako formální
  role v pipeline existuje (ChatDev má 7 rolí vč. Designera), nástroje typu
  v0/Galileo/Uizard by šly napojit; (d) různé modely pro různé role (levný na
  mechanické kroky, silný na plánování/review) je běžná praxe, infra na to
  (`CLAUDE_MODEL` per bot) částečně existuje, šlo by zjemnit na úroveň subagenta;
  (e) klíčové pro architekturu — potvrzeno, že role jako TRVALÉ oddělené procesy
  NEJSOU dominantní vzor ani u profi systémů; dominantní je efemérní subagent
  uvnitř jedné orchestrující session (přesně vzor, co už `devbot`/`fbalbums`
  používají), persistuje se artefakt (dokument/kód/PR), ne agent samotný.
  Otevřené rozhodnutí: zadat devbotovi doladění prahů "kdy se ptát" (držet se
  jen dvou bran), a časem přidat "designer" roli + granulárnější volbu modelu
  per role pro budoucí delší appku — obojí čeká na uživatele, kdy/jestli to
  chce rozjet.
  **Doplněno 22.9. (rozhodnuto, zadáno):** tři navazující upřesnění, uživatel
  potvrdil "ano": (a) volba modelu per subagent už dnes technicky jde —
  `Agent` tool má parametr `model` (sonnet/opus/haiku/fable), není to
  omezené na jeden model za session, jen se to musí u volání subagenta
  explicitně nastavit; (b) checkpoint review nemá být čtení diffu v chatu
  (nepřehledné), ale skutečný GitHub PR (diff view) — chat jen odkaz +
  krátké shrnutí + rozhodovací příkaz ("merguj"/"over X"); (c) pro větší
  změny chce uživatel branch/PR umět stáhnout a spustit lokálně u sebe
  (`git fetch`+`checkout`), ne jen dívat se na GitHub — týká se to hlavně
  budoucích samostatných SW projektových botů (jako `fbalbums`), ne jen
  devbota, protože oba jedou stejnou šablonou z `META_BOT.md`. Zadáno:
  devbotovi upravit šablonu v `META_BOT.md` (checkpoint = reálný PR +
  lokálně spustitelná branch, model per subagent role), a `fbalbums`
  informováno, ať workflow od teď dodržuje — narazí na to, že zatím nemá
  GitHub remote (`personal/assistant/TASKS.md` "Hotovo", položka AI Studio),
  bude si to muset nejdřív založit (soukromé repo). Výsledky obou patří do
  jejich vlastních Telegram chatů.

## Rozpracováno

- **Nakup: Rohlík MCP registrace — úkol pro `devbot`, zatím nedoručen (`SendMessage` nedosažitelný)** (6.10.) → viz personal/devbot/TASKS.md
- **`ListAgents`/`SendMessage` cross-bot discovery nespolehlivé — zachytí jen úzké   okno, ne "proces běží"** (6.10.) → viz personal/devbot/TASKS.md
- **Devbotův proces běží bez `CLAUDE_CODE_OAUTH_TOKEN`, proto mu padá audit úkol — NENÍ potřeba nové přihlášení** (1.10.) → viz personal/devbot/TASKS.md
- **Mailista: Gmail MCP nedostupný od 17.9. — skutečná příčina i konkrétní oprava
  nalezené, čeká se na uživatelův krok na claude.ai** (22.9.) — noční
  `nightly_cleanup.sh` selhává denně od 17.9. ("Gmail MCP nástroje nejsou
  dostupné"), do 16.9. běžel v pořádku. Ráno 22.9. slepá ulička s teorií
  vypršelého CLI loginu (`~/.claude/.credentials.json`) — soubor sice stojí od
  14.9., ale ani `CLAUDE_CODE_OAUTH_TOKEN` v crontabu Gmail nezpřístupní.
  Skutečný mechanismus: `~/.claude.json` má cachovaný GrowthBook flag
  `tengu_mcp_local_oauth_blocked_hosts` (`gmail.mcp.claude.com` +
  microsoft365, gcal). Ověřeno přímo v binárce CLI (`strings` +
  dekompilace `claude.exe` v2.1.270) — je to NAPEVNO zabudované chování, ne
  dočasný/vzdálený výpadek: Gmail/Microsoft365/Gcal jsou "Anthropic-hosted"
  konektory, co záměrně nepodporují lokální (CLI/headless) OAuth handshake.
  Sama chybová hláška v kódu ale dává návod na opravu: "Connect it via
  Settings → Connectors on claude.ai (requires `claude login`), then it'll
  be available here automatically." V `~/.claude.json` je navíc
  `claudeAiMcpEverConnected: ["claude.ai Gmail", ...]` — Gmail konektor byl
  přes claude.ai web někdy propojený, něco se muselo rozpadnout na téhle
  webové straně kolem 16./17.9., ne v lokálním tokenu. **Konkrétní další
  krok (jen uživatel, přes prohlížeč):** claude.ai → Settings → Connectors →
  zkontrolovat/znovu připojit Gmail (účet `hustoleslukas@gmail.com`, stejný
  jako `claude login`). Po tom by měl noční cron začít fungovat sám, bez
  zásahu do kódu mailisty. Opravená informace poslána mailistovi přes
  `SendMessage`, ať nahradí starou verzi ("čekáme na Anthropic") v jeho
  vlastním chatu.
  **Doplněno 24.9.**: mailista nahlásil přes `SendMessage`, že dávka #291
  (24.9.) selhala se stejnou příčinou (Gmail nástroje nedostupné) a mezi 16.9.
  a 24.9. v `CLEANUP_PROGRESS.md` není žádná úspěšná dávka — connector je tedy
  nefunkční nepřetržitě 8 dní, uživatelův krok na claude.ai zatím neproběhl
  (nebo nezabral). Pořád čeká jen na uživatele, žádná nová diagnóza potřeba.
- **Přidělování modelů jednotlivým agentům/botům — mechanismus hotový** (19.8.) → viz personal/devbot/TASKS.md
- **OAuth výpadek 14.9. — úkol doručen `devbot`, čeká se na výsledek** (15.9.) → viz personal/devbot/TASKS.md
- **Outbox.ts blokující fronta na trvalé 4xx chybě — úkol doručen `devbot`** (15.9.) → viz personal/devbot/TASKS.md

## Odloženo (po výše uvedeném)

- **Trading bot (AI autonomně obchoduje s malým kapitálem) — experiment,
  odloženo za research/rady bota** (3.10.) — navazuje na finanční bota výše.
  Deep research (subagent, websearch) na otázku "vydělává to reálně někomu?":
  nejčistší veřejný test (Alpha Arena, říjen–listopad 2025, 6 frontier LLM
  modelů vč. Claude Sonnet 4.5, po $10 000 reálného kapitálu, identické
  podmínky) skončil tak, že 4 ze 6 modelů ztratily 40–59 % kapitálu za dva
  týdny (hlavně přepáčkování/chybějící risk management), jen 2 skončily v
  plusu. Novější akademická literatura (2025) explicitně varuje, že
  současné LLM "nejsou připravené na plně autonomní nasazení v živém trhu"
  (halucinace čísel, selhávání v bočních trzích). U malého kapitálu (řádu
  $10) navíc poplatky/spread proporcionálně sežerou většinu prostoru pro
  zisk — realističtější funkční minimum je spíš $250–500. Rizika: únik
  API klíčů/peněženky (citovaný případ ztráty $250–441 tis. z jedné chyby),
  prompt injection přes manipulovaná market data, u cizích hotových botů
  časté skryté škodlivé chování (32 ze 47 testovaných v jedné studii).
  Nejmenší reálně funkční setup: Alpaca (akcie/ETF, $0 minimum, stavěné pro
  API boty) nebo Freqtrade/Binance (crypto), vždy nejdřív paper-trading.
  **Uživatelovo rozhodnutí (3.10.):** i tak chce experimentovat — bere to
  jako "technologie se rychle zlepšuje, nefunguje dobře teď ≠ nebude
  fungovat za rok", ne jako čekaný zdroj příjmu. Platí beze změny princip
  "cokoliv s penězi = nízká autonomie": než se tohle rozjede, potřeba
  explicitně odsouhlasit konkrétní částku/strop předem (žádné "ať si dělá
  co chce" bez schváleného limitu) a začít v paper-trading režimu. Rozjet
  až po research/rady botovi, zatím beze spec detailů (broker/API, limit
  částky, jak se hlásí výsledky) — ty se doladí, až na to přijde řada.

- **Orchestrátor napříč repozitáři + práce (Claude Code) + jiné AI providery** (30.9.)
  — tři navazující nápady z jedné debaty, nic z toho founded, jen ujasněné pro
  budoucí rozhodnutí:
  (a) *Cross-repo orchestrátor* — navazuje na "cross-project orchestrátor" z
  Ludwigova factory backlogu výše. Vyjasněný vztah k projektovým botům: neruší
  je, běží vedle — orchestrátor je task-scoped (dostane úkol, sáhne přes
  efemérní subagenty do repa/repů, co potřebuje, zmizí), projektový bot
  (`fbalbums`) zůstává relationship-scoped (trvalý kontext jednoho produktu).
  Použití: cross-repo/ad-hoc tasky nebo repa bez vlastního bota (obdoba toho,
  jak uživatel v práci občas dělá úpravy napříč víc repy v jedné session).
  Review vždy lokálně přes git/IDE, nikdy jen v Telegramu.
  (b) *Napojení pracovního Claude Code* — odloženo, uživatel zatím nemá
  kontinuální pracovní task, na který by se to hodilo. Firemní politika není
  bloker (malá firma, chtějí AI využívat naplno). Pokud se otevře znovu: vzor
  jako `devbot`/`fbalbums` (jedna session na jeden task, ne trvale žvatlající
  bot), na stroji s přístupem k pracovnímu repu/credentials.
  (c) *Jiní AI provideři (OpenAI, Gemini, ...)* — `bridge-ts` dnes umí jen
  `claude -p` CLI, přepnutí `--model` funguje jen mezi Claude modely. Další
  provider by potřeboval vlastní adaptér (jejich CLI/agentní nástroj místo
  Claude CLI) — buď jako samostatný bot stejnou šablonou, nebo (složitěji) jako
  nástroj volaný zevnitř Claude session (MCP/API), ne přes `Agent` tool.
  Uživatel to určitě bude v budoucnu zvažovat, zatím bez konkrétního use-case.
  Žádná z těchto tří položek nemá termín ani rozhodnutí — čeká na budoucí
  podnět uživatele.
- **Ovládání hlasem (STT, čeština)** — zamítnuto uživatelem 24.8. po zjištění, že
  by to vyžadovalo placenou externí službu (Whisper API); nechce za to platit,
  preferuje psané zprávy. Neotevírat znovu bez podnětu od uživatele.
- **Infra-review agent** → viz personal/devbot/TASKS.md
- **Šablona/podsystém pro jednotlivé SW projekty** (nápad 19.8.) → viz personal/devbot/TASKS.md
- **Kuchařka** (nápad 24.8.) — zatím jen název nápadu, náplň/rozsah nedomluvený.
- **Research bot (opus)** — 24.8.: přesunuto sem z "Čeká na uživatele", uživatel
  zatím nemá co researchovat, žádná pravidla/konvence tedy nejsou k domluvení.
  Beze změny, dokud nepřijde konkrétní podnět.
- **Dockerizace — pilot po 2 kontejnerech místo 1 na bota** (4.9., předáno botovi   `devbot` 7.9.) → viz personal/devbot/TASKS.md

## Hotovo

- **Trenér — bot na kalorie/sport založen a běží** (22.9.) → viz personal/devbot/TASKS.md
- **DevBot — založen a běží** (7.9.) → viz personal/devbot/TASKS.md
- **AI Studio → první produkt FB Albums — bot založen a běží** (25.8.–4.9.) → viz personal/devbot/TASKS.md
- **Joby: denní hledání přepnuto z `CronCreate` na crontab+skript** (24.–25.8.) → viz personal/devbot/TASKS.md
- **Nákupní lístek — založen jako samostatný bot** (24.8.) → viz personal/devbot/TASKS.md
- **Bot na hledání pracovních nabídek — založen (`joby`, `@LukasuvHlidacJobuBot`)**   (24.8.) → viz personal/devbot/TASKS.md
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
- **Nahrávání souborů/obrázků přes Telegram** (19.8.) → viz personal/devbot/TASKS.md
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
- **Git pro `agent-system`** (17.8., zjištěno jako hotové 18.8.) → viz personal/devbot/TASKS.md
- **Obsahové zadání zpravodaje a mailisty** — vyřešeno přímo s uživatelem v chatech
  jednotlivých botů.
- **Trvalý přístup do `personal/dashboard/` bez SSH tunelu** (18.8.) → viz personal/devbot/TASKS.md
- **Dashboard: sledování vyčerpání kvóty Claude Pro** (18.8.) → viz personal/devbot/TASKS.md
- **Dashboard: sekce "Aktivita (posledních 24h)" + proklik na log + restart tlačítko**   (18.8.) → viz personal/devbot/TASKS.md
- **Nasazení tří oprav + token logging v `bridge-ts`** (18.8.) → viz personal/devbot/TASKS.md
- **Zpravodaj infrastruktura** (17.8.) → viz personal/devbot/TASKS.md
- **Mail agent infrastruktura** (17.8.) → viz personal/devbot/TASKS.md

## Odloženo

- **Agent na zakládání agentů** (Ludwigův `agentsmon new` vzor) → viz personal/devbot/TASKS.md
