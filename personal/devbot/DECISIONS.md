# DevBot — architektonická rozhodnutí

## Telegram UX: `parse_mode: "Markdown"` (legacy V1), ne `MarkdownV2`

**Decision:** `sendRaw` posílá chunky s `parse_mode: "Markdown"` (legacy
styl: `*bold*`, `_italic_`, `` `code` ``). Při chybě parsování entit
(`GrammyError`, `error_code` 400, popis obsahuje "can't parse entities") se
stejný chunk pošle znovu bez `parse_mode` (syrový text, dnešní chování) —
teprve jiná chyba probublá dál k `outbox`.

**Why:** `MarkdownV2` vyžaduje escapovat širokou sadu běžných interpunkčních
znaků (`_*[]()~\`>#+-=|{}.!`) v celém textu mimo entity — Claude generuje
běžnou prózu/markdown, ne MarkdownV2-safe text, takže by prakticky každá
zpráva s tečkou, závorkou nebo pomlčkou skončila na 400 a spadla do
fallbacku (formátování by se ztrácelo skoro pořád, funkce by byla
bezúčelná). Legacy `Markdown` netoleruje jen nepárové/rozjeté entity
(`*`, `_`, `` ` ``, `[`), což je řádově vzácnější. Vedlejší efekt: Claude
běžně píše `**tučně**` (dvojhvězdička, standardní markdown), legacy mód
bere jen jednu hvězdičku jako přepínač — dvojice hvězdiček se spáruje do
dvou prázdných tučných úseků bez viditelného formátování, ale bez chyby
parsování (sudý počet, korektně uzavřené). Ztráta tučného řezu je přijatelná
kosmetická vada teď; převod `**` → `*` je out of scope (druhá vlna).

**Alternatives:**
- `MarkdownV2` — zamítnuto, viz výš (masivní fallback rate).
- Žádný `parse_mode`, jen HTML sanitizace `<b>`/`<i>` generovaná z markdownu —
  zvažováno, ale znamená psát vlastní markdown→HTML převodník; mimo rozsah
  týhle iterace (jen `parse_mode` + fallback).

**Date:** 2026-09-17

## `outbox.ts` zahazuje trvale nedoručitelné zprávy (400/403) místo blokace celé fronty

**Decision:** `flush()` v catch bloku rozlišuje `GrammyError` s `error_code` 400
nebo 403 (trvalá chyba) od všeho ostatního (dočasná chyba — síť, 5xx, 429).
Trvalá chyba: zaloguje se, položka se zahodí (`shift`+`persist`), smyčka
pokračuje na další položku ve frontě. Dočasná chyba: beze změny — `return`,
další pokus až za `OUTBOX_RETRY_INTERVAL_MS`.

**Why:** Incident nahlášený `nakup` — jedna trvale nedoručitelná zpráva (400
"chat not found") zastavila `flush()` `return`em bez ohledu na typ chyby,
takže se zablokovalo doručování VŠEM chatům/zprávám za ní ve frontě na 3
týdny (log narostl na 145 MB). 400 typicky značí chybu vázanou na
konkrétní zprávu/chat (i "message too long", špatný Markdown) — retry by
dopadl stejně, zahození dává smysl obecně, ne jen pro tenhle incident. 403
(bot zablokovaný v chatu) je trvalé pro celý chat, ne jen zprávu — bude
zahazovat i každou další zprávu do stejného chatu potichu, ne blokovat
frontu; přijatelné (fronta funguje pro ostatní chaty), ale znamená tiché
mizení zpráv do zablokovaného chatu bez alertu.

**Alternatives:**
- Zahazovat po N opakovaných neúspěších bez ohledu na kód chyby — zamítnuto,
  nerozlišuje trvalé od dočasných, u dočasné chyby (výpadek sítě) by mohlo
  zahodit zprávu, co by při dalším pokusu prošla.
- Alertovat uživatele při 403 (zablokovaný chat) místo tichého zahození —
  zvažováno, ale mimo schválený rozsah týhle iterace; případná budoucí
  iterace.

**Date:** 2026-09-17

## Fallback větev `runClaude` respektuje `isError`, aktivní upozornění při OAuth výpadku (iterace A)

**Decision:** `RunClaudeOutcome` rozšířen o `"auth_error"` a `"error"` stav vedle
`"ok"`/`"rate_limited"`. Fallback větev (po restart+retry) teď kontroluje `isError`
stejně jako hlavní větev — dřív ho ignorovala a vracela chybový text jako `"ok"`
výsledek. Rozpoznaný OAuth vzor (`/oauth/i` + `/expired|authenticat/i` v textu)
jde jako `auth_error` broadcastem všem chatům (stejně jako rate limit — netýká se
jen tazatele, dokud auth nefunguje, neodpoví na nic). Ostatní chyby po fallbacku
jdou jako `error` jen tazateli s `⚠️` prefixem.

**Why:** Incident 14.9. — `"OAuth session expired and could not be refreshed"` se
poslalo uživateli jako běžný `✅ Výsledek`, protože fallback větev nekontrolovala
`isError`. Detekce přes text, ne strukturovaný signál (na rozdíl od rate limitu,
kde `claude` CLI posílá `rate_limit_event`) — auth chyba žádný takový event nemá.

**Alternatives:**
- Nechat obecné chyby (non-OAuth) dál jako `"ok"` s `⚠️` prefixem (původní vzor
  z catch větve) — zamítnuto, matoucí kombinace `✅ Výsledek` + `⚠️` text; nový
  `"error"` kind je jasnější, `index.ts` ho zobrazí bez `✅`.
- Krátkodobě detekovat OAuth vzor už v hlavní (první) větvi a přeskočit
  restart+retry úplně — zamítnuto, restart je levný a jindy skutečně pomůže
  (např. dočasná chyba spojení), netřeba měnit dnešní strukturu tam, kde bug
  není.

**Date:** 2026-09-17

## Mount META_BOT.md/ARCHITEKTURA.md do denního kontejneru jen read-only (iterace 3)

**Decision:** `docker-compose.daily.yml` mountuje `META_BOT.md` a `ARCHITEKTURA.md`
z kořene repa do denního kontejneru jako `:ro` (read-only), ne `:rw`, jak byl
původní záměr specu iterace 3.

**Why:** Spec počítal s read-write mountem, protože `personal/assistant/CLAUDE.md`
ukládá assistentovi tyhle dokumenty při architektonických změnách i zapisovat.
Code review + přímé ověření (test inode před/po zápisu nástrojem `Edit`)
ale ukázaly, že rw mount jednotlivého souboru nesplní účel: `Edit` nepíše
in-place, ale přes tmp-soubor+rename, takže výsledek skončí na novém inode,
který bind mount jednotlivého souboru (vázaný na inode zachycený při startu
kontejneru, ne na cestu) vůbec nevidí — zápis by se tiše ztratil, nepropsal
by se na host. Read-write mount by tak vytvořil falešný pocit, že zápis
funguje, zatímco by tiše mizel.

**Alternatives:**
- Ponechat rw mount beze změny — zamítnuto, prokazatelně nefunkční pro hlavní
  účel (in-container editace), riziko tichého mizení dat.
- Přesunout oba soubory do vlastního adresáře a mountovat ten adresář celý
  (adresářové mounty přežijí i rename) — technicky správné řešení problému,
  ale zasahuje `bridge-ts/src` referencí (ověřeno gremem: 0, viz TASKS.md) a
  9 dalších `CLAUDE.md`/`DECISIONS.md` napříč boty, co soubory odkazují
  jménem — moc velký zásah na opravu uvnitř už schválené malé iterace.
  Odloženo jako samostatná budoucí iterace, viz `TASKS.md`.
- Mount celého kořene repa read-write — zamítnuto, zbytečně velký blast
  radius (celý zdrojový kód, ne jen 2 dokumenty) za cenu vyřešení stejného
  problému, co menší adresářový mount vyřeší bezpečněji.

**Date:** 2026-09-15
