# Decisions — Personal Assistant

Formát dle sekce 13 `ARCHITEKTURA.md`: Decision / Why / Alternatives / Date.

---

Decision:
Založit strukturu podle sekce 16 architektury (`ARCHITEKTURA.md`), ale scoped jen na
`personal/assistant` (README.md, CLAUDE.md, DECISIONS.md), bez instrukčních souborů pro
Product/Developer/Reviewer/QA/Research agenty.

Why:
`bridge.py` dnes reálně zapojuje jen jednoho agenta (Assistant, cwd=personal/assistant,
jedno `claude -p` volání, žádný orchestrátor podle sekce 10). Instrukční soubory pro
agenty, které nemá kdo spustit, by byly jen dekorace — v rozporu s principem "Simple
first" (sekce 19). `CLAUDE.md` v tomto adresáři se navíc automaticky načítá při každém
spuštění Claude Code, takže řeší praktickou část mezery ze sekce 13 (trvalé instrukce
přežívající sessions) bez nutnosti stavět vlastní memory systém.

Alternatives:
1. Vytvořit rovnou všech 6 agentů (Product, Developer, Reviewer, QA, Research, Assistant)
   se složkami a instrukcemi — zamítnuto, žádný z nich kromě Assistant není zapojen do
   bridge.py, hrozí falešný dojem funkčnosti.
2. Nedělat nic, dokud nebude hotový orchestrátor — zamítnuto, uživatel chtěl začít reálně
   stavět a CLAUDE.md přináší okamžitou hodnotu (perzistentní instrukce) i bez orchestrátoru.

Date:
2026-08-16

---

Decision:
`projects/` zůstává zatím jen prázdný placeholder adresář bez konkrétních projektů
(HabitPet, FB Albums, Dentist Reviews z sekce 6 architektury).

Why:
Uživatel zatím nezadal konkrétní task pro žádný z těchto projektů, jen sdílel obecnou
architekturu. Zakládat repository strukturu bez konkrétního zadání by bylo stavění
dopředu (v rozporu s "Simple first").

Alternatives:
Založit prázdné složky pro habitpet/fb-albums/dentist-reviews rovnou — zamítnuto,
čeká se na konkrétní zadání k danému projektu.

Date:
2026-08-16

---

Decision:
`bridge.py` (`get_history`/`append_history`) ořezává `chat_history.txt` na posledních
`HISTORY_EXCHANGES` (10) výměn Uživatel/Claude místo posledních 30 řádků souboru. Zároveň
vzniká `MEMORY.md` vedle `DECISIONS.md` jako místo pro trvalé fakty/preference o uživateli
(oddělené od `DECISIONS.md`, který je jen pro technická/architektonická rozhodnutí).

Why:
Line-based ořez počítal řádky, ne zprávy — jedna víceřádková markdown odpověď (odrážky,
tučný text) snadno zabrala 15–20 řádků, takže se do okna reálně vešly jen ~2 poslední
výměny místo zamýšlených ~15. V praxi to mazalo kontext o proběhlých úpravách kódu
mnohem agresivněji, než odpovídalo záměru "posledních 30 řádků kontextu". Exchange-based
ořez řeší tenhle konkrétní bug bez stavby plnohodnotného memory systému (vektorová DB/RAG
by byly předčasná komplexita — "Simple first", sekce 19). `MEMORY.md` řeší jinou mezeru:
fakty o uživateli, které mají přežít i mimo posledních N výměn, ale nejsou "rozhodnutí".

Alternatives:
1. Zvýšit limit řádků (např. na 100) — zamítnuto, jen oddaluje stejný problém, neřeší
   nesoulad mezi "řádky" a "výměnami".
2. Postavit plnohodnotný memory systém (embeddings/retrieval nad historií) hned teď —
   zamítnuto, žádný current use case to nevyžaduje, přidalo by komplexitu bez využití.
3. Sloučit fakty o uživateli do `DECISIONS.md` — zamítnuto, jde o odlišnou kategorii
   obsahu (uživatelské fakty vs. technická rozhodnutí) a míchání by ztížilo čitelnost obou.

Date:
2026-08-17

---

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

---

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

---

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

---

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

## Oprava: race condition v ClaudeProcess způsobovala falešné "EOF" chyby

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

## Otevřené otázky pro budoucího meta-bota (bota, co bude vytvářet jiné boty)

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

---

## Oprava: usage limit hlášku bral bridge jako hotovou odpověď, úkol se ztratil beze stopy

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

---

## Oprava: timeout v send() nechal starý proces běžet dál a "ukradl" odpověď další zprávě

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

---

## Incident: zpravodaj (ne mailista) ručně restartoval "hlavního bota", duplicitní proces shodil všechny tři

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

---

## Dashboard: `personal/dashboard/` — stav botů + historie restartů

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

## Dashboard rozšíření: aktivita z turn logu, syrový log, restart tlačítko

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

---

## Pravidlo: skripty mimo bridge-ts musí při chybě aktivně upozornit, ne jen logovat

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

## Dashboard přístup: Tailscale místo SSH tunelu

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

## Zjištění: SendMessage adresa může zastarat, odpověď se pak tiše neztratí, ale zpozdí

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

---

## Výsledek delegovaného úkolu patří do vlastního chatu bota, ne jen do SendMessage zpátky

Decision:
Když deleguji úkol jinému botovi (zpravodaj, mailista) přes `SendMessage`, finální
výsledek má bot poslat do svého VLASTNÍHO Telegram chatu (stejný mechanismus jako
"📥 dostal jsem úkol" / "⏳ zpracovávám"), ne jen zpátky mně přes `SendMessage`.
`SendMessage` zpátky zůstává jen jako krátké potvrzení/koordinace.

Why:
Uživatel: smysl delegace odsud je zadávat úkoly libovolnému botovi (i víc najednou),
ne aby se assistant stal povinným prostředníkem, který každý výstup čte a přeposílá
dál. Když bot dělá přesně to, pro co byl postavený (např. zpravodajův digest),
výsledek patří tam, kde ho uživatel přirozeně čte — v chatu toho bota.

Alternatives:
Nechat výsledek jen přes `SendMessage` zpátky assistentovi, který ho pak sám
přeformuluje/přepošle uživateli — zamítnuto, dělá z assistenta bottleneck a
neškáluje na víc paralelních delegací.

Date:
2026-08-18
