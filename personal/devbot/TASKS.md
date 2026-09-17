# DevBot — otevřené úkoly

## Rozpracováno

### Iterace B — watchdog rozliší "neběží" vs. "běží, ale auth nefunguje" (17.9.)

Iterace A (hotovo) opravila, že OAuth výpadek se aktivně nahlásí místo tichého
doručení jako běžný výsledek — ale jen v rámci `bridge-ts` procesu samotného.
Watchdog na hostu dnes umí zjistit jen "proces neběží" (`pgrep`), ne "proces
běží, ale je v `auth_error` smyčce" — to bylo v původním zadání jako bod 3,
zůstává samostatná iterace (jiný typ řešení, bash health-check místo TS kódu).

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
