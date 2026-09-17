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

## Odloženo

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
