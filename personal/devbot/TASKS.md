# DevBot — otevřené úkoly

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

### `handleUnsolicitedLine` posílá do Telegramu každý mezikrok zvlášť, ne až finální text (zjištěno 21.9.)

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

## Odloženo

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
