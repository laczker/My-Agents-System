# Rozhodnutí — Trenér

Formát: Decision / Why / Alternatives / Date.

## Založení bota "trenér"

**Decision**: Nový bot `personal/trener` (profil `trener`) na sledování stravy
(kalorie, text nebo foto) a sportu (běh, lezení, další), založený podle šablony
v `docs/META_BOT.md` §2. MVP: jídlo text/foto s odhadem kalorií, sport ruční zápis,
uložení `log.json` (append-only, žádná DB).

**Why**: Lukáš dlouhodobě (roky) neúspěšně zkouší zhubnout i přes sport a
občasné zdravé stravování — chce jednoduchý přehledový nástroj, ne přesný
nutriční tracker. Založeno přímo asistentem (ne přes dedikovaného "bota na
boty") — pořád platí odložené rozhodnutí z 24.8. (`agentsmon new` vzor čeká na
víc reálných specialistů, viz `docs/META_BOT.md` §5).

**Alternatives**:
- Napojení na Strava/Garmin hned od začátku — zamítnuto, Lukáš zatím chce jen
  ruční zápis sportu, OAuth/sync je zbytečná komplexita předem (viz "simple
  first"). Otevřeno jako budoucí rozšíření v `TASKS.md`.
- Přesný nutriční výpočet (vážení, databáze potravin) — zamítnuto, Lukáš
  vědomě chce jen orientační odhad, ne dopodrobna přesné počítání (stejně jako
  aplikace, kterou používal dřív).

**Date**: 2026-09-22

## Dvě denní připomínky (13:00 a 23:00)

**Decision**: Samostatný skript `checkin.sh` (mimo `bridge-ts`, po vzoru
`personal/zpravodaj/daily_digest.sh`), spouštěný hodinovým systémovým cronem,
který ve 13:00 a 23:00 pražského času pošle do Telegramu krátkou statickou
výzvu ("co jsi zatím jedl/dělal" / "večerní shrnutí"). Lukášova odpověď v
Telegramu pak jde standardní cestou přes `bridge-ts` a zpracuje se jako běžná
zpráva (zápis do `log.json`) — skript sám žádný obsah negeneruje ani nevolá
`claude -p`. Výpadek (Telegram API) se řeší stejným outage-marker vzorem jako
u ostatních botů (jedna varovná zpráva za výpadek, retry v dalším hodinovém
tiku, vzdání se po 24 h).

**Why**: Lukáš chce vnější impuls k zapisování dvakrát denně, ne spoléhat na
to, že si sám vzpomene napsat. `CronCreate` (nástroj dostupný v konverzaci)
nešel použít — jede jen v rámci jedné Claude session, mizí po jejím konci a
sám vyprší po 7 dnech, což pro trvalou denní připomínku nedává smysl u bota,
co běží nepřetržitě přes `watchdog.sh`. Systémový crontab + samostatný skript
je přesně vzor, který v systému už existuje pro jiné pravidelné úlohy
(zpravodaj, joby, mailista).

**Alternatives**:
- `CronCreate` uvnitř téhle konverzace — zamítnuto, viz Why (session-only,
  7denní expirace).
- Nechat skript i generovat/personalizovat text výzvy přes `claude -p` — zbytečná
  komplexita pro dvě prosté statické zprávy, navíc by to bez potřeby stálo
  kvótu; ponecháno jako pevný text.

**Date**: 2026-09-22

## Denní běžící součet kalorií po každém zápisu jídla

**Decision**: U každého zápisu jídla/pití přes den připojit k odpovědi i
aktuální běžící součet kalorií za daný den a kolik zbývá do denního rozpočtu
(pracovně 2450 kcal/den, střed pásma 2400-2550 z výpočtu deficitu ~500 kcal;
lze kdykoliv na žádost upravit). Netýká se to shrnutí týdne/měsíce (tam
zůstává na vyžádání jako dosud) ani to neznamená přísné varování/moralizování
při překročení — jen věcné číslo.

**Why**: Lukáš explicitně řekl, že se chce v průběhu dne hlídat ("po obědě
zmrzlina → kolik už mi zbývá") — to je jiná potřeba než původní "shrnutí na
vyžádání" model z předchozího rozhodnutí ten samý den. Jde o průběžnou
orientaci k dennímu rozpočtu, ne o přesné počítání do gramu — pořád platí
tón bez moralizování (viz `CLAUDE.md`), jen se navíc ukazuje číslo.

**Alternatives**:
- Ponechat jen shrnutí na vyžádání (původní rozhodnutí ze stejného dne) —
  zamítnuto, přímo odporuje nové explicitní žádosti.
- Automatický souhrn ke každé večerní připomínce navíc k running total —
  zvažováno, ale zatím nevyžádáno; running total po každém jídle stačí, lze
  přidat později.

**Date**: 2026-09-22

## Kontrola reálného času u zápisů (ne jen čas zprávy)

**Decision**: `timestamp` v `log.json` má odpovídat reálnému času, kdy se
věc stala, ne mechanicky času, kdy Lukáš napsal zprávu. Když píše o věci
hned ("teď jsem dojedl..."), beru čas zprávy. Když popisuje víc věcí najednou
nebo zpětně (např. shrnutí odpoledne, "k obědu jsem měl...", odpověď na
23:00 připomínku o tom, co bylo přes den), buď z kontextu odhadnu reálný čas
(logicky navazující časy k předchozím záznamům/denní době), nebo když to není
jasné, rovnou se zeptám na hodinu místo hádání. U prvního zápisu dne
(22.9.) jsem časy jednotlivých položek jen odhadl (08:00-16:05) bez ověření —
od teď se u nejasných případů radši doptám.

**Why**: Lukáš chce mít přesnou časovou osu (kvůli běžícímu dennímu součtu i
budoucím trendům), ne umělé rozestupy vymyšlené jen proto, aby záznamy
nešly na sebe. Souvisí s [[Denní běžící součet kalorií po každém zápisu
jídla]] — bez správného pořadí v čase by průběžný součet/zbytek do rozpočtu
mohl být zavádějící.

**Alternatives**:
- Vždy použít čas zprávy jako timestamp — zamítnuto, u zpětných/hromadných
  zápisů (typicky večerní shrnutí ve 23:00) by to shlukovalo časy k jednomu
  okamžiku a rozbilo to smysl časové osy přes den.
- Vždy se ptát na přesný čas u každé položky — zamítnuto jako zbytečně
  otravné pro běžný "hned po jídle" zápis, kde je čas zprávy stejně
  správný.

**Date**: 2026-09-22

## Ověřovat aktuální čas/den u zápisů pozdě večer (ne jen datum ze systému)

**Decision**: Systémové info dává jen aktuální datum, ne hodinu — pro zápisy
večer (orientačně od cca 22:00 dál) nebo kdykoliv není z kontextu jasné, jestli
zpráva ještě patří do právě probíhajícího dne nebo už po půlnoci do dalšího,
se aktivně zeptám na aktuální čas/den, než timestamp odhadnu. Týká se to hlavně
situací, kdy by špatný den rozbil běžící denní součet kalorií (viz [[Denní
běžící součet kalorií po každém zápisu jídla]]) — např. zápis po půlnoci by se
mylně přičetl k předchozímu dni, nebo naopak.

**Why**: 22.9. večer jsem u zápisu (matonky/objednávka jídla) nezkontroloval,
jestli mezitím nepřešel den, a spoléhal jen na datum ze systémového kontextu
(to se navíc nemusí aktualizovat spolu s reálným časem zprávy). Lukáš na to
upozornil (bylo ještě úterý 23:44, ale mohlo to klidně být jinak) a chce mít
tohle ošetřené i do budoucna, ne se spoléhat na odhad.

**Alternatives**:
- Spoléhat na datum ze systémového promptu bez ověření — zamítnuto, přesně
  tohle způsobilo nejistotu 22.9. večer.
- Ptát se na čas u úplně každé zprávy večer bez ohledu na kontext — zamítnuto
  jako zbytečně otravné, když je z konverzace jasné, že jsme pořád ve stejném
  dni (např. plynulá konverzace bez přestávky).

**Date**: 2026-09-22

## Cheat den — na žádost bez přesného počítání kalorií

**Decision**: Když Lukáš označí den/večer jako "cheat" (víc drobných/nárazových
položek najednou — piva, pizza, chlebíčky apod., kde přesný odhad nemá smysl),
zapíšu ho jako jeden souhrnný záznam s vyjmenovanými položkami, `poznamka:
"cheat den"` a `kalorie_odhad: null` — bez počítání kcal a bez tlaku na zbytek
do rozpočtu. Denní součet za zbytek dne (před cheat částí) počítám dál normálně,
jen tahle část se do "kolik zbývá" nezapočítává (protože se vědomě nepočítá).
Nejde o automatické rozhodnutí z mé strany — platí jen když to Lukáš výslovně
řekne (např. "cheat den", "tohle nemá smysl počítat").

**Why**: 23.9. večer měl Lukáš víc drobných položek najednou (5 piv, pizza,
chlebíčky, čokoláda) a řekl, že to už nemá smysl přesně počítat — chce jen
označit den jako cheat, ne přerušit sledování úplně. Souvisí s [[Denní běžící
součet kalorií po každém zápisu jídla]] — cheat den se do runningu prostě
nezapočítává tou přesnou částí.

**Alternatives**:
- Přesto odhadnout kcal jako u běžných záznamů — zamítnuto, přesně tomu se
  Lukáš chtěl vyhnout ("už ani není třeba počítat").
- Cheat den úplně vynechat z logu — zamítnuto, i cheat den chce mít
  zaznamenaný (aspoň co jedl), jen bez čísel.

**Date**: 2026-09-23

## 2026-10-06: trener moved from host to daily-bots (Docker pilot iteration 10)
- Runs as the 6th profile in the `daily-bots` container; the host block in `watchdog.sh` was removed.
- `checkin.sh` stays an hourly host cron job (static Telegram message, no bridge).
- Not in the dashboard config yet; adding it is a separate small iteration.
