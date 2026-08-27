# Mailista — rozhodnutí

## Noční čištění inboxu: přesun z `CronCreate` na systémový crontab + samostatný skript

Co:
Noční dávkové čištění inboxu (chronologické, marketing smaž / ostatní
archivuj — viz `CLEANUP_PROGRESS.md`) běželo dosud přes `CronCreate`
naplánovaný uvnitř běžící session (probouzení co ~20 min mezi půlnocí a
6:00). V noci 26.-27.8. se to zase potichu zastavilo po pár dávkách —
`CronCreate` žije jen v paměti běžícího `bridge-ts` procesu a zmizí beze
stopy při jeho restartu (rate limit, watchdog po pádu, cyklení kontextu).
Přesně tahle díra byla u joby bota opravena už 24.-25.8. (viz
`META_BOT.md` §3.5), ale u mailisty se oprava nikdy neudělala.

Založil jsem `personal/mailista/nightly_cleanup.sh` — samostatný skript
nezávislý na `bridge-ts`, spouštěný ze **systémového** `crontab` (`*/20 * * *
*`, celý den; skript sám podle pražského času pozná okno 00:00-05:59 a mimo
něj hned skončí bez logu). V okně zavolá `claude -p` s pokynem přečíst
`CLEANUP_PROGRESS.md`, zpracovat další dávku (~100 vláken) a zápis do
progress souboru aktualizovat; v 06:xx pošle jednou denně ranní shrnutí.

Telegram zprávy za noc: jedna na začátku ("pouštím se do..."), jedna na
konci (ranní shrnutí s počty), plus okamžitá eskalace, pokud dávka narazí na
něco, co je potřeba řešit hned (bezpečnostní/finanční rozhodnutí) — nic mezi
tím, aby to nebyl spam. Výpadek (rate limit) uprostřed noci: jedna varovná
zpráva při první chybě, tiché opakování co 20 min dál, jedna zpráva při
zotavení — stejný vzor jako `personal/zpravodaj/daily_digest.sh`
(DECISIONS.md 24.8.), ne opakované hlášení téhož výpadku.

Why:
`CronCreate` je v pořádku jen pro krátkodobé probouzení uvnitř jedné aktivní
session, ne pro cokoliv, co má přežít restart procesu — přesně to potvrzuje
`META_BOT.md` §3.5. Trvalá noční smyčka potřebuje záruku nezávislou na tom,
jestli session zrovna běží.

Alternatives:
Spoléhat na assistentův self-pace loop, ať mailistu v noci sám budí přes
`SendMessage` — zamítnuto, protože to pořád vyžaduje, aby assistentova
vlastní session běžela nepřetržitě a aby mailista session, kterou budí,
neztratila kontext/nebyla zrovna restartovaná; systémový crontab + samostatný
`claude -p` proces je nezávislý na obojím a je to už ověřený vzor
(zpravodaj, joby).

Date:
2026-08-27
