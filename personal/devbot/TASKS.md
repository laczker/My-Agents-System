# DevBot — otevřené úkoly

## Rozpracováno

### Canary cutover `nakup` do daily-bots kontejneru — VYŘEŠENO 5.10.

Schváleno uživatelem (spec + checkpoint, 5.10.): `nakup` jako první denní
profil migrovaný z hostu do Docker kontejneru (iterace 6, `DAILY_PROFILES=
nakup` v `docker-compose.daily.yml`, `start-daily.sh` čte proměnnou). Postup:
1) souběžný test (viz checkpoint kontrola 1, OK), 2) po schválení kill
hostového `nakup`, 3) `watchdog.sh` přepnutý na kontejnerové hlídání jen pro
`nakup` (ostatní 4 profily beze změny), 4) `docker compose up -d`.

Při live cutoveru odhalen a hned opraven **kritický bug** — `node:20-slim`
image (`Dockerfile.daily`) neobsahuje `procps`, tedy žádný `pgrep`/`pkill`.
Watchdogova kontrola uvnitř kontejneru (`docker compose exec ... pgrep`)
proto vždycky vracela exit 127 → **každou minutu force-recreate kontejneru**,
potvrzeno v `watchdog.log` (jeden cyklus proběhl, než se stihlo zasáhnout).
Oprava: `RUN apt-get install -y procps` do `Dockerfile.daily`, rebuild,
ověřeno (`pgrep`/`pkill` exit 0 uvnitř), 2 další cron tiky bez dalšího
force-recreate. Dashboardí restart tlačítko pro `nakup` (`inContainer: true`,
`exec ... pkill`) mělo stejnou závislost — oprava v stejném kroku.

Stav po iteraci: `nakup` běží v kontejneru, čerstvý heartbeat, žádný
`409 Conflict` po cutoveru (host proces skutečně dole). Zbylé 4 denní profily
(assistant, zpravodaj, mailista, joby) pořád na hostu, čekají na vlastní
schválený cutover — viz "Aktivace watchdog restartu kontejneru v cronu" níž,
teď už částečně hotové (vzor pro `nakup` existuje a je ověřený naživo).

### Cutover `assistant` do daily-bots kontejneru — VYŘEŠENO 7.10.

Schváleno uživatelem (spec + checkpoint, 7.10.): `assistant` jako druhý denní
profil (`DAILY_PROFILES=nakup assistant`), stejný vzor jako `nakup`. Po
mergi (`worktree-docker-cutover-assistant-v2`) kill hostového `assistant`
procesu (pid z 3.10.), `docker compose up -d` — kontejner recreated i přes
cron `watchdog.sh` (detekoval `assistant` chybějící v novém compose stavu
dřív, než jsem stihl rebuild spustit sám, viz `watchdog.log` 09:52:01 — žádný
manuální restart běžícího procesu, konzistentní s konvencí). Ověřeno:
heartbeat `personal/assistant/heartbeat_ts.txt` postupuje (09:52:49 →
09:53:49), žádný `409 Conflict` v logu kontejneru, `nakup` v kontejneru
nedotčený.

Zbylé 3 denní profily (zpravodaj, mailista, joby) pořád na hostu — pořadí
podle analytika z iterace 7: `joby`, `mailista`, naposled `zpravodaj`
(historie OOM + webapp na portu 8766 mimo scope).

### Restart skripty startovaly nový proces sám (`nohup`), dědil env téhle session, ne crontabu — 2× OAuth výpadek 5.10. — VYŘEŠENO 5.10.

Oprava self-killu (viz položka níž) pořád nechávala `restart_devbot.sh` i
`restart_remaining_profiles.sh` startovat nový proces samy (`nohup npx tsx
... &` z vlastní bash session). Po schváleném mergi a restartu 5.10. ~09:03
to způsobilo přesně tohle: nový proces zdědil environment *agentní session*,
ne crontabu, takže běžel bez platného `CLAUDE_CODE_OAUTH_TOKEN` → dva dotazy
uživatele ("povedlo se?", "jsi tu?") spadly na `OAuth session expired`
(09:04–09:35), než ho cron `watchdog.sh` o ~30 min později nahodil správně.
Přesně odpovídá rozhodnutí z 1.10. v `personal/assistant/DECISIONS.md`
("vlastní restartovací skripty mimo cron nesmí sám spouštět nový proces"),
které tahle oprava tiše porušovala.

**Vyřešeno 5.10.** (branch `worktree-restart-scripts-no-selfstart`,
smergováno do `main` jako `7ecc2bc`): oba skripty po zabití starého procesu
už nic nestartují samy — `restore_cron()` se volá hned po killu, health-check
polluje až 90s na proces nahozený `watchdog.sh` (přes cron, tedy se správným
environem) a navíc ověřuje čerstvost heartbeatu, ne jen že PID běží.
`/code-review` (high) našel 4 nálezy, žádný blokující, žádný v scope týhle
iterace — zapsány jako samostatné poznámky níž.

**Ověření na živém devbotovi (5.10. ~12:41–12:43):** první pokus o test
(`bash restart_devbot.sh`, relativní cesta bez `./`) skončil zdánlivě
úspěšně (exit 0), ale **self-detach ve skutečnosti neproběhl** —
`setsid "$0" "$@"` s `$0` bez `/` dělá `execvp` PATH lookup na holé jméno
souboru, ten v `PATH` není, takže `setsid` selhal (`No such file or
directory` v logu bez timestampu, mimo `log()`) a celá reálná práce skriptu
se nikdy nespustila; cron ani proces zůstaly nedotčené (ověřeno — starý PID
běžel dál). Druhý pokus s absolutní cestou
(`/home/agent/agent-system/restart_devbot.sh`) proběhl správně: starý proces
zabit 12:42:15, cron re-enable 12:42:17, nový proces nahozený
`watchdog.sh` detekován 12:43:03 (45s), heartbeat čerstvý. `/proc/<pid>
/environ` nového procesu obsahuje platný `CLAUDE_CODE_OAUTH_TOKEN` — potvrzeno,
že ho skutečně nastartoval cron (se správným environem), ne tahle session.

**Nový nález, zatím neopravený (vedlejší produkt testu, ne scope týhle
iterace):** self-detach (`setsid "$0" "$@"`) tiše neudělá nic, pokud je
skript spuštěný tak, že `$0` nemá v sobě `/` (např. `bash restart_devbot.sh`
z adresáře, místo `./restart_devbot.sh` nebo absolutní cesty) — `exit 0` z
obalu vypadá jako úspěch, ale reálný restart se nestane a žádný alert se
nepošle (chyba padne mimo `send_alert`/`log()` cestu). V produkčním použití
agentem by k tomu nemělo dojít, pokud se skript vždy volá s cestou, ale je to
fragilní tiché selhání stojící za budoucí malou opravu (např. `readlink -f
"$0"` před self-detach re-execem). Netýká se `restart_remaining_profiles.sh`
stejně — needitováno, needověřeno, zmiňuju jen jako stejnou třídu rizika.

### `restart_devbot.sh` se umí zabít uprostřed sebe sama — devbot mimo provoz ~40h, cron watchdog vypnutý celosystémově (incident 1.–3.10.) — VYŘEŠENO 5.10.

Restart po mergi `worktree-unsolicited-first-last` (1.10. 14:59:29) proběhl
přes `restart_devbot.sh` — stejný vzor jako předchozí úspěšný restart dřív
ten den (10:51, viz `bridge_ts_switch.log`). Tentokrát se ale zastavil hned
po `kill` kroku: log má `cron watchdog docasne vypnut` (14:59:29) a `devbot
zastaven` (15:00:29), ale **žádné** `devbot nastartovan` ani `cron watchdog
znovu zapnut` po něm — skript sám utrpěl stejný osud jako finální odpověď
popsaná v položce níž ("Sebe-restart devbota může zabít vlastní odpověď").
Skript běžel jako background proces spuštěný tímtéž `claude -p` tahem, co
patří do killovaného `devbot` řetězce (`CLAUDE_PID` v skriptu) — kill
vlastního předka smetl i jeho samotného, dřív než doběhl `nohup npx tsx ...`
restart a `crontab crontab_backup.txt` re-enable.

**Důsledek, ne jen devbot:** `crontab -l | grep -v watchdog.sh | crontab -`
zůstalo v platnosti ~40 hodin (1.10. 14:59 → 3.10. ~07:0x) — `watchdog.sh`
celosystémově neběžel přes cron, takže žádný profil by se nerestartoval při
padu. `devbot` byl po tu dobu mimo provoz úplně. `assistant` se v
`watchdog.log` objevuje jako "neběží, restartuji" přesně v 07:03:01 3.10. —
první tik watchdogu po návratu do crontabu — což naznačuje, že spadl někdy
během těch 40h a zůstal mrtvý neodhalený, dokud se cron nevrátil (ne přímý
důsledek tohohle restartu, ale odhalený jeho vedlejším efektem). Jak se
`watchdog.sh` zpátky do crontabu dostal není v žádném logu zaznamenáno —
`crontab_backup.txt` (mtime 14:59:29) ho obsahuje, nejpravděpodobnější
vysvětlení je manuální `crontab crontab_backup.txt` (uživatelem?), ne skript.

**Stav 3.10. ~07:05:** všech 8 profilů + dashboard má čerstvý heartbeat
(do minuty), cron watchdog aktivní, žádný další zásah nebyl potřeba.

**Vyřešeno 5.10.** (branch `worktree-restart-devbot-selfkill-fix`, smergováno
do `main`): `restart_devbot.sh` i `restart_remaining_profiles.sh` se teď na
startu odpojí od volajícího process tree (`setsid` guarded re-exec — fork,
rodič hned skončí, potomek běží v nové session, immune na "kill child PIDs"
i "kill celé process group"), re-enable cron watchdogu proběhne hned po
startu nového procesu/profilů, ne až na konci (fail-safe místo fail-open),
plus `trap ... EXIT` backstop pro neočekávané přerušení a aktivní Telegram
alert (`send_alert`) při selhání. `/code-review` navíc odhalil a oprava řeší
tichou chybu v `restore_cron()` (nastavovala `CRON_RESTORED=1` i při
neúspěšném `crontab`, takže retry se nikdy nespustil) a zpevnila zápis
`crontab_backup.txt` (`.new` + `mv`, aby transientní chyba při čtení
nesmazala existující dobrou zálohu). Oba skripty byly dosud needitované v
gitu — tímto commitem poprvé verzované. Ověřeno na živém restartu devbota
při téhle iteraci (viz chat_history kolem 5.10.) + testovacím harnessem
simulujícím self-kill scénář (ps pid/ppid/sid před/po).

Zbývá jako samostatné budoucí položky (záměrně mimo scope téhle iterace):
`pgrep -f "src/index\.ts devbot"` dělá substring match na celý command line
(teoreticky by mohl zabít nesouvisející proces se shodným textem v promptu —
existovalo už dřív, jiná třída chyby); `restart_remaining_profiles.sh` má
pořád desítky sekund okno s vypnutým cronem přes všech 7 profilů najednou,
ne per-profil (viz komentář ve skriptu). Souvisí s položkou níž ("Sebe-restart
devbota") — stejný nadřazený problém, tohle byla jeho horší varianta (umírá
skript, ne jen reply); timing problém sebe-restartu useknutí vlastní odpovědi
zůstává otevřený samostatně.

### Devbot vlastní pád 1.10. ~13:17–13:18 během hromadného restartu zbylých 6 profilů — příčina nejistá, chytil to cron watchdog

Při `restart_remaining_profiles.sh` (restart assistant/zpravodaj/mailista/joby/
nakup/fbalbums/trener kvůli nasazení rate-limit timeout fallbacku) spadl i
**devbotův vlastní proces** (běžící od 12:11 fixu OAuth-env-tokenu, viz
`personal/assistant/TASKS.md` 1.10.), přestože skript devbota explicitně
vynechává. Projevilo se to uprostřed odpovídání na "a co tedy máme hotovo?"
chybou `🔐 Claude autentizace vypadla (OAuth session expired)`, pak proces
spadl úplně — zachytil to až další pravidelný cron tik `watchdog.sh` v
13:18:11 (cron byl během skriptu dočasně vypnutý, takže nechytil hned).
Nový proces (pid ověřen, `CLAUDE_CODE_OAUTH_TOKEN` v environu přítomný) běží
zdravě od 13:18:11, žádný zásah nebyl potřeba.

**Nejpravděpodobnější příčina (neověřeno přímo, `dmesg` nedostupný bez root):**
těsná paměť (`free` ukázal ~740 MB volných z 3,7 GB při kontrole) — hromadný
restart 7 node/tsx procesů naráz je krátkodobý paměťový špičkový nápor, co
mohl OOM-killerem srazit i nesouvisející devbotův proces. Shoduje se to časově
přesně s oknem skriptu (cron vypnutý ~13:17–13:19).

**K dořešení:** pokud se to zopakuje, ověřit přímo (`journalctl -k` nebo
poprosit uživatele o `dmesg` s právy), případně hromadné restarty dělat po
menších dávkách místo všech 7 najednou, ne čekat na další náhodný incident.

## Poznámka k procesu

### `EnterWorktree` větví z `origin/main`, ne z lokálního `main` (zjištěno 17.9., iterace outbox)

`origin/main` na GitHubu je pozadu za lokálním `main` (naposledy pushnuto 9.9.,
lokální `main` má od té doby o 8 commitů víc, včetně celé iterace A OAuth
fixu) — není to rozdílná historie, jen zastaralý `origin`. Nový worktree přes
`EnterWorktree` (výchozí `baseRef: fresh`) se ale větví z `origin/main`, takže
by tiše chyběl obsah nedávno zamergovaných iterací, dokud by se nerebasoval na
lokální `main` ručně (jak se stalo tady — objeveno až při kontrole `git log`,
opraveno `git rebase main` bez konfliktů).

Do budoucna: po každém `EnterWorktree` ověřit `git merge-base HEAD main`, a
pokud se liší od `main`, rebasovat na lokální `main` dřív, než se začne
implementovat — ne až u kontroly před checkpointem.

## Připomínky

### `CLAUDE_CODE_OAUTH_TOKEN` (setup-token, crontab) — ověřit platnost ~15.9.2027 (zjištěno 21.9.)

Sdílený token pro všech 7 produkčních procesů (`claude setup-token`, headless
varianta) vznikl 15.9.2026 po incidentu s vypršením staré interaktivní
`/login` session (`~/.claude/.credentials.json`, refresh token s vlastní
expirací ~30 dní od založení v půlce srpna — to je to, co tehdy vypadlo).
Podle dokumentace (code.claude.com/docs/en/authentication) má `setup-token`
platnost cca 1 rok, tedy do ~15.9.2027 — ale token samotný (`sk-ant-oat01-...`)
je neprůhledný, nikde na disku není jeho vlastní expirační timestamp k
hlídání, takže to nejde ověřit proaktivně souborovou kontrolou (na rozdíl od
staré `refreshTokenExpiresAt`). Navíc dokumentovaná roční platnost je zatím
jen tvrzení z dokumentace, ne ověřený fakt (token v provozu teprve pár dní).

Proto jen ruční připomínka, ne watchdog kontrola: zkontrolovat/obnovit token
kolem 15.9.2027. Hlavní pojistka proti výpadku auth zůstává iterace B níž
(process-level detekce ve watchdogu), která funguje nezávisle na tom, jestli
tenhle konkrétní termín sedí.

## Rozpracováno

### Iterace B — watchdog rozliší "neběží" vs. "běží, ale auth nefunguje" (17.9.)

Iterace A (hotovo) opravila, že OAuth výpadek se aktivně nahlásí místo tichého
doručení jako běžný výsledek — ale jen v rámci `bridge-ts` procesu samotného.
Watchdog na hostu dnes umí zjistit jen "proces neběží" (`pgrep`), ne "proces
běží, ale je v `auth_error` smyčce" — to bylo v původním zadání jako bod 3,
zůstává samostatná iterace (jiný typ řešení, bash health-check místo TS kódu).

Zjištěno u review iterace A: `auth_error` detekce funguje jen na text z
úspěšně vrácené `is_error` odpovědi. Pokud OAuth výpadek shodí `claude`
proces rovnou (EOF na stdout, žádný `result` event), `runClaude` to vidí jen
jako obecnou výjimku bez textu k rozpoznání — process-level detekce ve
watchdogu (iterace B) tenhle případ pokryje, textová detekce v `bridge-ts`
ne.

### `handleUnsolicitedLine` posílá do Telegramu každý mezikrok zvlášť, ne až finální text (zjištěno 21.9., vyřešeno 1.10.)

Při rozboru ztráty kontextu (1ok2ok incident, 21.9.) se odhalilo, že
`handleUnsolicitedLine` v `bridge-ts/src/claudeProcess.ts` (ř. 140–181) posílá
do Telegramu (`broadcastMsg`) živě **každý `assistant` textový blok zvlášť**,
ne až finální `result` — záměrný design (komentář v kódu, ř. 140–156) kvůli
genuinním cross-session událostem (`SendMessage` od jiného bota, začátek/konec
dávkové práce), kde by čekání na finální text ztratilo mezikroky.

Problém: dokončení background subagenta (např. vývojář spuštěný na pozadí)
prochází stejnou unsolicited větví. Když mezi voláními nástrojů napíšu
pracovní poznámku, letí jako samostatná zpráva do Telegramu, i když se to
snažím omezit na "intro + finální checkpoint" ([[feedback_devops_no_subagent_spam]]).
`[TICHO]` prefix to potlačí, ale musel by být na doslova každém mezikroku
zvlášť — křehké, snadno se to poruší (stalo se 21.9., 4 zprávy místo 1).
Přímé odpovědi uživateli nejsou dotčené — ty jdou přes normální `send()`
cestu v `index.ts`, kde se posílá jen jeden finální `outcome.text`.

Souvisí s iterací "zápis unsolicited textu do `chat_history.txt`" (21.9.,
stejný soubor/callback) — ale jde o oddělený problém (doručování do
Telegramu vs. zápis do historie), řešit jako samostatnou budoucí iteraci se
svým specem, ne rozšíření té právě běžící. Možný směr řešení (needomluveno):
bufferovat unsolicited text a poslat souhrnně až na `result`/timeout, s
výjimkou pro skutečně živé cross-session zprávy — potřeba rozmyslet, jak
rozlišit "background dokončení mého vlastního subagenta" od "cizí bot mi
něco poslal", než se z toho udělá spec.

**Vyřešeno (1.10.):** spec se nakonec vyhnul rozlišování původu bloku a místo
toho se zaměřil na *pozici* v tahu — `handleUnsolicitedLine` teď posílá živě
jen první `assistant` blok a finální `result` text, ne každý mezikrok mezi
nimi (`firstBlockSeen` gate, `bridge-ts/src/claudeProcess.ts`). `[TICHO]`
zůstává funkční jako doplněk pro umlčení i prvního/posledního bloku.
Implementováno ve worktree (`worktree-unsolicited-first-last`), ověřeno
offline simulací JSON streamu, `/code-review` bez nálezů, checkpoint
schválen a smergováno do `main`. Restart devbotova procesu proveden přes
`restart_devbot.sh` (vypne cron watchdog, kill+restart chain, zapne zpět).
Ostatních 6 profilů + fbalbums se restart netýkal, zůstávají na starém kódu,
dokud se neschválí zvlášť.

**Incident (zjištěno a opraveno 3.10., asistentem):** `restart_devbot.sh`
spuštěný 1.10. 14:59 se zasekl přesně v místě, co předchozí review jen
opatrně odhadovalo — `bridge_ts_switch.log` končí na řádku "cron watchdog
docasne vypnut" a "devbot zastaven", ale chybí "nastartovan" i "cron
watchdog znovu zapnut". Skript po killu starého procesu nikdy nedoběhl do
konce (přesná příčina procesu samotného neznámá — nevypsal žádnou chybu,
jen zmizel), takže **devbot byl mrtvý přes 2 dny (1.10. 15:00 → 3.10.) a
cron watchdog byl celou dobu vyřazený z crontabu** (`crontab -l` bez
`watchdog.sh` řádku) — proto ho nikdo/nic nenahodilo zpátky. Oprava: `crontab
/home/agent/agent-system/crontab_backup.txt` (zálohovaný skriptem těsně
před vypnutím, obsahoval watchdog řádku správně), pak ruční start procesu.
Po startu se objevil `409 Conflict` na `getUpdates` (starý Telegram
long-poll ještě doznívající) — vyřešilo se samo po pár desítkách sekund
backoffu (`STARTUP_409_RETRY_DELAYS_MS`), žádný webhook ani cizí proces to
nezpůsoboval (ověřeno `getWebhookInfo`, `docker ps`, `ss -tnp`). Heartbeat
od 3.10. 7:05 běží zdravě.

**Důležitější zjištění pro budoucno:** tenhle incident je přesně ten typ
selhání, co `personal/assistant/CLAUDE.md` (sekce "Skripty mimo bridge-ts")
popisuje — skript běžící mimo `bridge-ts`/cron, co při chybě tiše zmizí bez
jakéhokoliv upozornění, takže to nikdo nezachytí, dokud se nezeptá uživatel.
`restart_devbot.sh` i `restart_remaining_profiles.sh` (oba v rootu repa) mají
stejnou slabinu: pokud skript spadne/zůstane trčet mezi "vypnout cron
watchdog" a "zapnout zpět", systém zůstane bez supervize neomezeně dlouho a
nikdo se to nedozví. Do budoucna by obě měly mít `trap` na EXIT/ERR, co
cron watchdog vrátí zpátky za každou cenu (ne jen na konci happy path), a
ideálně i poslat Telegram/SendMessage upozornění, pokud se skript nedokončí
v očekávaném čase.

### Sebe-restart devbota může zabít vlastní odpověď uprostřed tahu (zjištěno 30.9., incident při restartu po mergi úklidu komentářů)

Restart po schváleném mergi (7 profilů + dashboard + devbot) ukázal, že
proces, který zrovna generuje odpověď uživateli, běží jako potomek `claude -p`
podprocesu spuštěného právě tím `bridge-ts` řetězcem, co se má restartovat
(`ps` strom: `npm exec tsx src/index.ts devbot` → ... → `claude -p --resume
<session_id>` → tahle bash session). Kill vlastního řetězce uprostřed tahu
useknu odpověď dřív, než `index.ts` dostane finální `result` a zavolá
`send()` — uživatel nedostane nic, žádnou chybu, jen ticho.

Řešení použité 30.9.: naplánovat kill+restart jako detached background
skript (`nohup bash -c 'sleep 20; kill ...; nohup npx tsx ... &' & disown`)
se zpožděním, aby stihla doletět odpověď před tím, než se proces zabije.
Zabralo to jen částečně — restart se sice provedl, ale odpověď na schválení
mergu se přesto neposlala (uživatel se pak sám zeptal "co se stalo?").
Nevyřešeno proč přesně (možné vysvětlení: 20s nestačilo, nebo `send()` sám
o sobě něco blokovalo). Navíc stejný restartovací pokus přispěl k `409 Conflict` závodu s cron
watchdogem popsanému v `DECISIONS.md` (30.9., "Restart přes `watchdog.sh`
konvenci musí nejdřív dočasně vypnout cron watchdog") — skript nevypínal
cron watchdog.

Souvisí s položkou výš (`handleUnsolicitedLine`) — obě jsou instance stejného
nadřazeného tématu ("automatické ozvání se/nezmizení odpovědi"), co uživatel
opakovaně vznáší. Než se bude řešit jako iterace, potřeba spec: (a) jak
bezpečně zjistit, že finální odpověď už byla `send()`-nuta, než se proces
smí zabít (např. čekat na zápis do `chat_history.txt` daného tahu, ne pevné
zpoždění), (b) vždy nejdřív vypnout cron watchdog (viz `DECISIONS.md`).

### Sjednotit základní chování agentů napříč systémem — zatím bez specu (vzneseno 1.10.)

Uživatel (1.10., po incidentu s self-restartem 30.9. a diskuzi o tom, proč
devbot po rate-limitu sám nenavázal) vznesl širší požadavek: nezajímá ho
dílčí vysvětlení rozdílu cron-skripty vs. živá `bridge-ts` session, chce
**sjednotit základní věci a fungování agentů napříč celým systémem** — jmenovitě
zmínil, že se mu opakovaně stává, že mezikroky (textové poznámky mezi voláními
nástrojů, ne finální checkpoint) vyjdou do Telegramu anglicky, přestože jazyková
kázeň (čeština vždy, i technické poznámky) je už domluvená jinde (`CLAUDE.md`
sekce "Jazyk", a related [[feedback_devops_no_subagent_spam]] pro frekvenci
mezikroků).

Zatím nemá schválený spec ani přesně vymezený rozsah — "sjednotit fungování
agentů" je příliš široké na rovnou kódování (viz vlastní pravidlo výš v
`CLAUDE.md`, iterace musí být malá/recenzovatelná). Než půjde ke specu,
potřeba od uživatele zúžit: jde čistě o jazykovou kázeň v mezikrocích (dalo by
se řešit jako rozšíření [[handleUnsolicitedLine]] položky — detekovat/zabránit
anglickému textu v `broadcastMsg`), nebo chce širší audit konvencí napříč
`CLAUDE.md` soubory všech profilů? Souvisí s existujícími položkami výš
(`handleUnsolicitedLine`, sebe-restart) — stejné nadřazené téma "co přesně
uniká do Telegramu a v jaké podobě".

Rozsah zúžen 1.10.: uživatel chce napřed poslat subagenta, co audituje
`CLAUDE.md` všech 8 profilů a vypíše konkrétní rozdíly (bez doporučení) —
podle toho se teprve rozhodne, co sjednotit. Audit běží (zadáno 1.10.).

**Čerstvý konkrétní důkaz (1.10., iterace 5 Docker pilot/fbalbums):** uživatel
vlepil přímo výpis z vlastního Telegram chatu, co ukazuje obojí porušení
najednou — mezikroky mezi voláními nástrojů (`These look well-formed...`,
`All three binaries check out...`) vyšly anglicky, a zároveň přišly jako
samostatné zprávy (ne jedna úvodní + `[TICHO]` mezikroky + jeden finální
checkpoint, jak `CLAUDE.md` předepisuje). Potvrzuje to, že `[TICHO]` kázeň
([[handleUnsolicitedLine]] výš) je křehká napříč celým tahem, ne jen u
background subagenta — stejná třída selhání, co se stala i 21.9. (4 zprávy
místo 1). Uživatel to explicitně zadal jako samostatný úkol k vyřešení
("mimo někam si dej úkol"), ne jen k zapsání — až audit CLAUDE.md dodá
rozdíly, tohle je konkrétní repro k prioritizaci řešení (pravděpodobně
směr: `bridge-ts` bufferuje/potlačuje mezikroky strukturálně, ne spoléhání
na to, že si na `[TICHO]`/češtinu u každého textového bloku vzpomenu sám).

Uživatel zároveň navrhl navazující krok (1.10., zatím jen nápad, ne
zadání): až se rozdíly sjednotí, sepsat z toho **dokument/šablonu, podle
které bude `personal/assistant` zakládat nové boty** — tzn. výstup týhle
položky by neměl být jen jednorázové sladění `CLAUDE.md` souborů, ale i
trvalý artefakt pro budoucí boty (umístění/formát zatím neurčeno — možná
`META_BOT.md` dostane novou sekci, možná samostatný soubor). Řešit až po
auditu a rozhodnutí o sjednocení, ne souběžně.

**Další recidiva (5.10., nahlásil uživatel asistentovi):** čerstvý úryvek z
Telegram chatu ukazuje stejné porušení znovu, i po mergi `firstBlockSeen`
fixu z 1.10. — mezikroky typu `Worktree created manually via git worktree
add...`, `Good, no stray test processes remain...` vyšly anglicky a jako
samostatné zprávy, ne jen úvod + finální checkpoint. Buď fix nedrží v praxi,
nebo tenhle konkrétní výstup (vývojářský subagent spuštěný na pozadí) jde
jinou cestou než `handleUnsolicitedLine` předpokládá. Současně uživatel
nahlásil dva další, dosud jen částečně zdokumentované projevy téhož
nadřazeného tématu: po restartu devbot sám nenavazuje na rozdělanou práci
(viz "Sebe-restart devbota může zabít vlastní odpověď" výš) a nedává aktivně
vědět, že se něco změnilo (restart proběhl / práce se ztratila) — ticho bez
signálu, přesně typ selhání z `personal/assistant/CLAUDE.md` sekce "Skripty
mimo bridge-ts".

Zapsáno jen jako další důkaz k existující otevřené položce — **uživatel
výslovně řekl, ať se to teď neřeší** (žádná akce, žádné zadání devbotovi),
jen to má být v `TASKS.md` pro příští kolo, až se spec dořeší.

## Odloženo

### Seznam kontejnerových profilů duplicitně na 3 místech (zjištěno 7.10., review iterace 7 — cutover `assistant`)

Který denní profil běží v `daily-bots` kontejneru se dnes udržuje nezávisle
na třech místech: `DAILY_PROFILES` v `docker-compose.daily.yml`, `for profile
in nakup assistant` smyčka ve `watchdog.sh`, a `inContainer: true` flag u
každého bota v `personal/dashboard/src/config.ts`. Zapomenutí jednoho z nich
při příštím cutoveru (zpravodaj/mailista/joby) je tichá chyba — např. profil
by běžel v kontejneru, ale watchdog by ho nehlídal, nebo dashboard restart
tlačítko by no-opnulo proti hostu. Zatím to review při každé iteraci odchytává
(viz iterace 6 i 7), ale architektonicky čistší je jeden zdroj pravdy (např.
watchdog.sh/dashboard čtou `DAILY_PROFILES` ze stejné proměnné/souboru místo
vlastní kopie seznamu) — samostatná budoucí iterace, ne blokující tuhle.

### `chat_history.txt` roste bez rotace, teď i rychleji (zjištěno 21.9., review iterace "zápis unsolicited textu do historie")

Iterace přidala do `handleUnsolicitedLine` druhý, častější zdroj zápisu do
`chat_history.txt` (každý nemlčený unsolicited tah — cross-session zadání od
jiného bota, dokončení async subagenta), vedle původního zápisu z běžných
Telegram tahů. `history.ts` (`getHistory`) ale při čtení dělá `readFileSync`
na celý soubor a teprve v paměti ho ořízne na posledních `HISTORY_EXCHANGES`
(10) výměn — soubor na disku se nikdy netrimuje. Předchozí návrh (existující
už před touhle iterací, ne nový) na velikosti nezáleželo, protože zápisy byly
řídké; teď rostou rychleji. Zatím nejde o naléhavé riziko (růst v řádu KB/den),
ale patří to sledovat u hostu s historií OOM (~3,7 GB RAM, viz `META_BOT.md`
§4). Oprava (rotace/trim `chat_history.txt` na disku, ne jen v paměti) je
sdílená změna `bridge-ts/src/history.ts` napříč všemi 7 profily — samostatná
budoucí iterace se svým specem, ne součást týhle.

### `unescapeDelimiter` může smazat genuinní zero-width space v obsahu (zjištěno 21.9., 3. kolo review)

`escapeDelimiter`/`unescapeDelimiter` (`bridge-ts/src/history.ts`) rozlišují
escapovanou sekvenci od originálu jen bajtově — pokud by text sám o sobě
obsahoval `"---" + zero-width space + "\n"` (např. vložený z externího zdroje
s neviditelnými znaky), `unescapeDelimiter` ho při čtení smaže, i když ho
`escapeDelimiter` nikdy nevložil. Okrajový případ (dvojitá kolize — literální
`---\n` PLUS zero-width space na stejném místě), neřešeno teď — architektonicky
čistší oprava je změna formátu (JSON-lines místo textového delimiteru, viz
review nález "altitude" a zamítnutá alternativa v `DECISIONS.md`), ne další
vrstva escapování. Sledovat, jestli se v praxi projeví.

### Úklid komentářů v kódu — bez češtiny, bez AI komentářového balastu (zadáno 30.9., hotovo 30.9.)

Implementováno ve worktree (`worktree-cleanup-comments`), `/code-review` proběhl
(1 nález — quotovaný český název sekce v `TASKS.md` přeložený do angličtiny ve
`watchdog.sh` komentáři by rozbil textový odkaz, protože `TASKS.md` zůstává
česky podle specu — opraveno). Čeká na schválení checkpointu, pak merge.

---

Uživatel chce před víkendovým review (chystá se otevřít kódovou základnu ve
vlastním IDE a rozjet nad ní vlastní instanci Claude Code, aby si systém
prošel) pročistit komentáře napříč celým systémem — žádné komentáře v
češtině, žádný typický AI-generovaný komentářový balast (komentáře, co jen
opakují, co už říká název funkce/proměnné). Dopadá na sdílený produkční kód
napříč všemi boty (min. `bridge-ts`), ne jen na devbot.

**Spec schválen (30.9.):** rozsah = zdrojové soubory (`bridge-ts/src/*.ts`,
`personal/dashboard/src/*.ts`, `*.sh` skripty napříč boty) — bez češtiny, bez
AI komentářového balastu. **Ne** `CLAUDE.md`/`TASKS.md`/`DECISIONS.md`/
`META_BOT.md`/`ARCHITEKTURA.md` (dokumentace pro uživatele, záměrně česky).
Implementace jde ve worktree přes vývojáře (subagent), pak `/code-review`,
pak konsolidovaný checkpoint ke schválení — stejný cyklus jako ostatní
iterace (sdílený provoz).

### Dockerfile.daily verze `claude` CLI neodpovídá hostiteli (zjištěno 30.9.)

Při přípravě upgradu sdíleného `claude` (host) na `2.1.280` zjištěno, že
`Dockerfile.daily` má verzi připnutou na `2.1.233` — neodpovídá ani současné
hostitelské `2.1.270` (mělo se bumpovat ručně při každé aktualizaci
hostitele, minule se to zjevně přeskočilo). Sladit jako malou samostatnou
iteraci až po dokončení probíhajícího hostitelského upgradu.

### Adresářový mount pro META_BOT.md/ARCHITEKTURA.md (zjištěno 15.9., iterace 3)

Iterace 3 mountuje `META_BOT.md`/`ARCHITEKTURA.md` do denního kontejneru jen
**read-only** — read-write mount jednotlivého souboru nefunguje spolehlivě
(Linux bind mount je vázaný na inode zachycený při startu kontejneru, ne na
cestu; `Edit` nástroj píše přes tmp+rename, takže zápis skončí na novém
inode, co bind mount nevidí — ověřeno přímým testem inode před/po). Detaily
v `META_BOT.md` §4a.

Strukturální oprava: přesunout oba soubory do vlastního adresáře (stejný
vzor jako `personal/<profil>`) a mountovat ten adresář jako celek — adresářový
mount vidí živý obsah, přežije i rename uvnitř. Rozsah zjištěný 15.9. (ověřeno
grepem): žádná cesta v `bridge-ts/src` na tyhle 2 soubory natvrdo neodkazuje,
takže kód se nedotkne; dotkne se ale 9 dalších `CLAUDE.md`/`DECISIONS.md`
napříč boty, co na soubory odkazují jménem (bez cesty) — proto samostatná
budoucí iterace se svým vlastním specem, ne součást iterace 3.

Dokud nevyřešeno: assistant (a kdokoliv jiný) uvnitř kontejneru nemůže
`META_BOT.md`/`ARCHITEKTURA.md` upravovat — architektonické změny, co CLAUDE.md
ukládá zapisovat do těchto souborů, musí probíhat na hostu, ne v kontejneru.

### Telegram UX vylepšení v bridge-ts — první vlna hotová (17.9.), druhá čeká

Uživatel 15.9. přes asistenta požádal o research, proč Telegram u kolegy (řešení
od Ludwiga, `petrludwig-collab/Agent2Telegram`, inspirace pro celý systém)
působí víc jako živý chat — typing animace, reakce na zprávu, lepší formátování.
Asistent research udělal a zjištění poslal mně (`devbot`) přes `SendMessage`
týž den: **první vlna** — typing indikátor (`sendChatAction`) + Markdown
formátování (`parse_mode` v `bot.api.sendMessage`, `bridge-ts`), s poznámkou
otestovat, než se to dotkne doručování zpráv ostatním 6 botům. **Druhá vlna**
(zadaná jako budoucí, ne součást prvního zadání): reply na konkrétní zprávu
(`reply_parameters`), emoji reakce (`setMessageReaction`), živá editace zprávy
(`editMessageText` místo "⏳ Zpracovávám...").

Realita: nikdy jsem se do toho nepustil. V `chat_history.txt` tady u mě po
zadání není jediná zmínka typing/markdown/parse_mode/sendChatAction — místo
toho jsem rovnou pokračoval Docker pilotem. Na rozdíl od OAuth bugu a
`outbox.ts` fronty (obě aspoň zapsané v `personal/assistant/TASKS.md` sekci
"Rozpracováno") tenhle úkol nebyl zapsaný nikde kromě samotné konverzace —
hůř dohledatelné, stejná chyba (nepřevzal jsem SendMessage úkol do vlastního
TASKS.md a nechal ho převálcovat dalším "pokračuj").

**První vlna hotová 17.9.** (branch `worktree-telegram-ux-typing-markdown`):
`startTypingIndicator()` v `index.ts` posílá `sendChatAction("typing")` na
začátku zpracování úkolu, opakuje po 4s, `clearInterval` ve `finally` kolem
`runClaude`. `sendRaw` zkouší `parse_mode: "Markdown"` (legacy V1, ne
MarkdownV2 — zdůvodnění v `DECISIONS.md`), při chybě parsování entit
(`error_code` 400, "can't parse entities") fallback pošle stejný chunk
znovu bez `parse_mode`. Otestováno jen typecheckem + `/code-review`, ne
živě na produkčním provozu jiných botů — sdílený kód pro všech 7, sledovat
logy po nasazení, jestli fallback cesta funguje i v praxi.

**Doladění 17.9.** (branch `worktree-devbot-typing-instead-of-text`): uživatel
po nasazení první vlny nahlásil, že animaci s tečkama nevidí — ukázalo se, že
`index.ts` u prázdné fronty posílal ještě textovou "⏳ Zpracovávám..." hlášku
(`bot.on("message")`), která typing indikátor časově zastiňovala. Hláška se u
tohohle případu teď neposílá vůbec, jen typing animace (spouští se prakticky
souběžně, uvnitř `processQueue` před `runClaude`). "📥 Přijato, ve frontě..."
hláška pro neprázdnou frontu zůstává beze změny.

**Druhá vlna (zůstává, mimo scope týhle iterace):** reply na konkrétní
zprávu (`reply_parameters`), emoji reakce (`setMessageReaction`), živá
editace zprávy (`editMessageText` místo "⏳ Zpracovávám...").

### Aktivace watchdog restartu kontejneru v cronu (zjištěno 16.9., iterace 4)

Iterace 4 přidává do `watchdog.sh` schopnost hlídat/restartovat denní Docker
kontejner (`docker compose up -d`), ale záměrně ji nezapojuje do automatického
minutového cronu — jen ověřeno ručně. Důvod: dokud kontejner neběží naostro
místo hostových procesů (cutover ještě neproběhl), automatický restart by
mohl kontejner nastartovat se skutečnými tokeny souběžně s běžícím hostovým
procesem téhož bota → kolize Telegram `getUpdates` long-pollu (viz `META_BOT.md`
§4a).

Až bude domluvený cutover na kontejner (host procesy pro denní boty se
vypnou), je potřeba: 1) rozhodnout/schválit s uživatelem přesný okamžik
přepnutí, 2) zapojit watchdog kontrolu kontejneru do cronu, 3) zároveň
odstranit/vypnout hostové `pgrep`/`nohup` bloky pro denní profily ve
`watchdog.sh`, ať nehlídá oboje najednou. Samostatná budoucí iterace se
svým specem, ne automatické zapnutí jako vedlejší efekt.

### Obnova OAuth tokenu: restart kontejneru po `claude /login` (zjištěno 6.10.)

Po vypršení OAuth tokenu nestačí přihlášení na hostu — `daily-bots` kontejner
mountuje `~/.claude/credentials.json` bind-mountem a Claude CLI soubor zapisuje
atomicky (nový inode), takže kontejner dál vidí starý, prošlý soubor.

Postup při příštím vypršení: 1) `su - agent` (ne root!), `claude /login`,
2) `docker compose restart daily-bots` (jen restart, ne rebuild/kill) — mount se
obnoví, 3) ověřit `claude -p "ping"` uvnitř kontejneru. Bude se opakovat při
každém refresh tokenu; kandidát na trvalé řešení: mountovat celý adresář
`~/.claude/` místo jednoho souboru (samostatná iterace, vyžaduje spec).

### Dokončený převod na Docker — VYŘEŠENO 6.10. (iterace 8)

Na přímou žádost uživatele provedeno najednou, bez samostatného specu/checkpointu:
zpravodaj/mailista/joby do `daily-bots`, `fbalbums` do `project-bots`,
`watchdog.sh` + dashboard přepnuté. Ověřeno: heartbeaty všech 6 profilů čerstvé,
žádný 409/EACCES v logu obou kontejnerů. `/code-review` neproběhl.
Otevřené: oba compose soubory sdílí project name `agent-system` → varování
"orphan containers" (nepoužívat `--remove-orphans`; řešení `name:` v každém
souboru); `trener` a `devbot` zůstávají na hostu (devbot nemůže restartovat sám sebe).

### Rohlík MCP pro nakup — VYŘEŠENO 6.10.

`personal/nakup/.mcp.json` (rohlik) + schválení v hostovém `~/.claude.json` +
OAuth přihlášení na hostu (`su - agent`, `claude`, `/mcp`; callback přes `curl`
na `localhost:<port>`). Kontejner `daily-bots` token uvidí až po
`--force-recreate` (single-file mount drží starý inode). `claude mcp list` v
kontejneru: `Connected`. Po vypršení tokenu zopakovat přihlášení na hostu +
recreate `daily-bots`.

### Iterace 9 — ověření SendMessage (rozpracováno 6.10.)

`ListAgents` z hosta po restartu vidí kontejnerové session `nakup-6d`/`nakup-ec`
→ směr host → kontejner registrován, test zprávy odeslán `nakup-ec`, ale DRŽEN (held, nepřečtený; jiný permission mode) — doručení neověřeno (do
inboxu)). Zbývá: směr kontejner → host (já, `devbot-e0`) a kontejner → kontejner.

Ověřeno 6.10.: kontejner → host (`nakup-d5` → `devbot-e1`) doručeno. Host → kontejner
(`nakup-ec`) drženo kvůli permission módu druhé strany (session `interactive`, ne bypass),
ne kvůli sdílení registru. Registr + sokety (`pid: host`, mounty) fungují.

- [2026-10-06] Iteration 10 done: trener runs in daily-bots (6 bots). Lesson: `start-daily.sh` is COPYed into the image (Dockerfile.daily), so changes to it need `docker compose -f docker-compose.daily.yml up -d --build --force-recreate`, not just recreate.
- Open: add trener to dashboard config.ts; consider mem_limit/restart limit for daily-bots.
