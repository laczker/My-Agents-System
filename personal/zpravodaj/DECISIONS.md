# Decisions — Zpravodaj

Formát dle sekce 13 `ARCHITEKTURA.md`: Decision / Why / Alternatives / Date.

---

Decision:
Denní ranní souhrn zpráv, posílaný v 8:00, ze zdrojů s oficiálním RSS: Alarm
(denikalarm.cz/feed), Deník N (denikn.cz/cesko/feed, denikn.cz/svet/feed — jen
titulek+perex, ne placený fulltext), iROZHLAS (irozhlas.cz/rss), Novinky.cz
(novinky.cz/rss), Seznam Zprávy (seznamzpravy.cz/rss). Formát: krátký strukturovaný
přehled (cca 6–8 bodů), ČR/svět odděleně, jedna věta k tématu + odkaz na zdroj.

Why:
Uživatel je fanda Alarmu, respektuje Deník N, poslouchá Vinohradskou 12 a sleduje
veřejnoprávní média, Novinky a Seznam Zprávy. Vinohradská 12 je audio talkshow bez
přepisu, nejde zahrnout do textového souhrnu stejně jako ostatní zdroje — vynechána
z denního digestu. Seznam Zprávy a Aktuálně.cz oficiálně RSS nenabízí obecně, ale
Seznam Zprávy má funkční RSS feed přímo, takže je zahrnut. LLM smí sumarizovat jen
z reálně staženého textu (žádné dogenerování nad rámec staženého obsahu), každá
položka musí mít odkaz na zdroj k ověření.

Alternatives:
1. Zahrnout i Vinohradskou 12 — zamítnuto, žádný textový přepis k sumarizaci.
2. Scraping Seznam Zprávy/Aktuálně.cz místo RSS — zamítnuto, křehké (rozbije se při
   změně layoutu) a hraniční z hlediska ToS; drženo jen u zdrojů s oficiálním RSS.

Date:
2026-08-17

---

Decision:
Rozšíření obsahového zadání o AI novinky. Dvě samostatné kategorie:
1. **AI novinky** (světové i lokální ČR) — hlavní zájem uživatele: věci využitelné
   k programování a k průběžnému vylepšování tohohle multi-agent systému
   (agent-system: bridge-ts, personal assistant, zpravodaj, mailista, dashboard).
   Zdroje nejsou omezené na klasická média — patří sem i programátorská fóra (HN,
   Reddit r/programming apod.). U technických věcí ne jen titulek/odstavec, ale
   pořádné prozkoumání do hloubky (deep research), ne povrchní shrnutí.
2. **Obecné zprávy** (ČR/svět, viz předchozí decision) — širší záběr, tady stačí
   něco zajímavého, netřeba do hloubky.

Frekvence se mění z nuceného denního reportu na **event-driven**: report jen když
je něco relevantního/zajímavého, ne nucený denní report bez obsahu (denní 8:00 cron
pro obecné zprávy tímhle zadáním neruší, ale AI novinky mají jet mimo pevný rytmus —
implementace zatím neřešena, viz TASKS.md).

Why:
Zadání přišlo 18.8. přes cross-session zprávu od `assistant-4a` (hlavní asistent),
který ho relayoval jménem uživatele (Lukáše) — nebylo doručeno přímo v tomhle chatu.
Zapsáno jako zdrojová specifikace, ale samotná implementace (např. nový cron/skript
pro AI-news monitoring, mechanismus rozhodování "je to dost relevantní na report")
čeká na přímé potvrzení od uživatele v tomhle chatu, než se do ní pustím — jde o
netriviální novou automatizaci (autonomní rozhodování, co reportovat a kdy), ne jen
o zápis specifikace.

Alternatives:
Implementovat rovnou na základě relayované zprávy bez potvrzení přímo od uživatele —
zamítnuto, druhá session může sice jednat jménem uživatele, ale nemůže sama schválit
novou autonomní automatizaci za něj v tomhle chatu.

Date:
2026-08-18

---

Decision:
Implementace AI-news skriptu (`ai_news_digest.sh`), samostatně vedle
`daily_digest.sh`. Model `--model opus` (Opus 5) — uživatel explicitně trval na
silnějším modelu pro tuhle úlohu, ne defaultní model `claude -p`. Mechanismus:
hodinový cron s vlastním filtrem hodin (08/12/16/20 Europe/Prague, stejný trik
jako `daily_digest.sh` kvůli DST), model dostane do promptu seznam už odeslaných
odkazů (`ai_news_seen.txt`, posledních 300 řádků) a instrukci NEOPAKOVAT stejné
téma. Pokud nic relevantního nenajde, odpoví přesně `ŽÁDNÉ NOVINKY` a skript nic
neposílá (event-driven, ne nucený report). Pokud najde, odpoví ve formátu
`ODKAZY:` blok + report; skript odkazy uloží do seen-listu a zbytek pošle na
Telegram.

Why:
Potvrzeno uživatelem přímo v chatu (18.8., + cross-session potvrzení modelu přes
`assistant-e5`). Frekvence 4x denně je výchozí odhad rovnováhy mezi "dost často na
to, aby to bylo užitečné" a náklady na opus + web search běh, který se navíc většinu
běhů stejně nic neodešle — může se dolaďovat podle reálného provozu.

Alternatives:
1. Vlít AI novinky do stávajícího `daily_digest.sh` (jeden report, jedna sekce) —
   zamítnuto, uživatel chtěl event-driven rytmus nezávislý na pevném 8:00 slotu.
2. Defaultní model bez `--model` (jako `daily_digest.sh`) — zamítnuto, uživatel
   chtěl výslovně silnější model kvůli hloubce researche.

Date:
2026-08-18

---

Decision:
Incident: první testovací běh `ai_news_digest.sh` (18.8., 15:11 UTC) spadl
(`FAIL status=1`), ale skript to jen zalogoval a nikam aktivně nenahlásil —
protože běží mimo `bridge-ts`/dashboard, nebylo to vidět přes `ListAgents` ani
frontu, jediná stopa byl vlastní log. Skutečná příčina se zpětně nedala zjistit
(skript zahazoval stdout/stderr chyby claude příkazu, logoval jen status kód).
Oprava: (1) `OUTPUT=$(... 2>&1)` místo odděleného přesměrování, aby se text
chyby při FAIL zalogoval celý; (2) při FAIL skript teď pošle Telegram varování
(`send_telegram`), ne jen log řádek. Druhý test se stejným zadáním proběhl bez
chyby (odesláno, 7 nových odkazů, 7393 znaků) — první pád tedy vypadá na
přechodný problém (např. dočasné přetížení API), ne na chybu v promptu/skriptu,
ale bez zachyceného textu to nejde s jistotou potvrdit.

Obecné pravidlo z tohohle incidentu (skripty mimo bridge-ts musí při chybě
aktivně upozornit, ne jen logovat) je teď zapsané i v `CLAUDE.md` (commit
`e1294ec`, platí napříč assistant/zpravodaj/mailista).

Cron řádek pro `ai_news_digest.sh` zatím záměrně nepřidán — čeká na explicitní
potvrzení uživatele/assistenta, že oprava + druhý úspěšný test stačí.

Why:
Bez aktivního upozornění by selhání mimo bridge-ts zůstalo navždy neviditelné —
přesně tenhle incident to demonstroval (uživatel/assistant si pádu všimli
nezávisle na tomhle skriptu, ne díky němu).

Alternatives:
Nechat jen log a spoléhat na to, že si to někdo občas zkontroluje ručně —
zamítnuto, přesně tohle selhalo.

Date:
2026-08-18

---

Decision:
Frekvence `ai_news_digest.sh` změněna z původního návrhu (4x denně: 08/12/16/20)
na **jednou týdně, pondělí 2:00 Europe/Prague**. Cron přidán (hodinový trigger,
skript sám pozná pondělí 2:00 stejným DST-safe trikem jako `daily_digest.sh`).
Zůstává event-driven v tom smyslu, že i v pondělí 2:00 pošle zprávu jen když
model najde něco relevantního (jinak `ŽÁDNÉ NOVINKY`, tiše).

Why:
Explicitní pokyn od uživatele (přes cross-session zprávu, 18.8., po ověření že
oprava chybové signalizace + druhý test fungují) — čtyřikrát denně bylo zjevně
víc, než uživatel chtěl; týdenní shrnutí na začátek týdne stačí.

Alternatives:
Ponechat 4x denně — zamítnuto explicitním pokynem uživatele.

Date:
2026-08-18

---

Decision:
Webovka na čtení digestů (`webapp/client` + `webapp/server`) hotová a zapojená
do `watchdog.sh`. Při prvním zapojení jsem udělal chybu: `pgrep` vzor pro
kontrolu "už běží?" používal relativní cestu (`src/index.ts` po `cd` do
`webapp/server`), ale spouštěcí příkaz taky předával jen relativní cestu jako
argument `npx tsx` — takže se v příkazové řádce procesu (vidět přes `ps aux`)
relativní cesta objevila jen jako `src/index.ts`, ne `webapp/server/src/index.ts`,
a `pgrep -f "tsx.*webapp/server/src/index.ts"` nikdy nenašel shodu. Výsledek:
watchdog (cron, každou minutu) spouštěl nový server znovu a znovu, každý další
pád na `EADDRINUSE` (port 8766 už obsazený tím předchozím) — identická třída
chyby jako opakované pády `personal/dashboard` zmíněné dřív v tomhle souboru.
Oprava: stejně jako dashboard blok, `npx tsx` teď dostává absolutní cestu ke
skriptu jako argument, ne jen `src/index.ts` po `cd` — `pgrep` pak najde shodu
podle stejného řetězce, co je v příkazové řádce.

Why:
Obecné pravidlo pro cokoliv přidávané do `watchdog.sh`: `pgrep -f` vzor musí
odpovídat přesně tomu, co se objeví v `ps aux` u spuštěného procesu — pokud se
spouští přes `cd dir && npx tsx relativní/cesta.ts`, `pgrep` na tu relativní
cestu nikdy nesedne, protože grep vidí jen to, co je v argumentech procesu
(cwd se nezapočítává). Bezpečné je vždy předávat a hledat podle absolutní
cesty, jak to dělá existující dashboard blok.

Alternatives:
Hledat podle portu (`lsof -i :8766`) místo `pgrep -f` na cestu skriptu —
zamítnuto, `lsof` na tomhle hostu není jistě dostupný a `pgrep` na absolutní
cestu je jednodušší a konzistentní se zbytkem `watchdog.sh`.

Date:
2026-08-18

---
</content>
