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

Decision: bridge.py: restart-on-crash přes cron watchdog + session resume (17.8.)

→ viz personal/devbot/DECISIONS.md

---

Decision: Jeden trvale běžící claude proces (stream-json) místo procesu na zprávu (17.8.)

→ viz personal/devbot/DECISIONS.md

---

Decision: Produkce přepnuta z bridge.py na bridge-ts (17.8.)

→ viz personal/devbot/DECISIONS.md

---

Decision: Proaktivní cyklení claude session podle velikosti kontextu (17.8.)

→ viz personal/devbot/DECISIONS.md

## Oprava: race condition v ClaudeProcess způsobovala falešné "EOF" chyby

→ viz personal/devbot/DECISIONS.md

## Otevřené otázky pro budoucího meta-bota (bota, co bude vytvářet jiné boty)

→ viz personal/devbot/DECISIONS.md

---

## Oprava: usage limit hlášku bral bridge jako hotovou odpověď, úkol se ztratil beze stopy

→ viz personal/devbot/DECISIONS.md

---

## Oprava: timeout v send() nechal starý proces běžet dál a "ukradl" odpověď další zprávě

→ viz personal/devbot/DECISIONS.md

---

## Incident: zpravodaj (ne mailista) ručně restartoval "hlavního bota", duplicitní proces shodil všechny tři

→ viz personal/devbot/DECISIONS.md

---

## Dashboard: `personal/dashboard/` — stav botů + historie restartů

→ viz personal/devbot/DECISIONS.md

## Dashboard rozšíření: aktivita z turn logu, syrový log, restart tlačítko

→ viz personal/devbot/DECISIONS.md

---

## Pravidlo: skripty mimo bridge-ts musí při chybě aktivně upozornit, ne jen logovat

→ viz personal/devbot/DECISIONS.md

## Dashboard přístup: Tailscale místo SSH tunelu

→ viz personal/devbot/DECISIONS.md

## Zjištění: SendMessage adresa může zastarat, odpověď se pak tiše neztratí, ale zpozdí

→ viz personal/devbot/DECISIONS.md

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

## Viditelnost platí i obráceně — příchozí požadavky od jiných botů na assistenta

Decision:
Když jinému botovi (zpravodaj, mailista) zadám úkol, musím to uživateli hned říct a
výsledek patří do vlastního chatu bota — to už bylo zavedené 18.8. Chybělo ale
zrcadlové pravidlo pro opačný směr: když naopak jiný bot pošle přes `SendMessage`
požadavek/otázku MNĚ (assistentovi), musím i tohle hned viditelně napsat uživateli do
JEHO chatu (od koho žádost je, co v ní je, že ji zpracovávám) a po vyřešení sem poslat
stručné shrnutí — ne to vyřešit potichu a odpovědět jen zpátky botovi do jeho chatu.
Doplněno do `CLAUDE.md`, sekce "Delegace na jiné boty".

Why:
Uživatel: "Když ti on posílal požadavek nic nevypsal ani jsem nevěděl že něco děláš a
hlavně jsi to vypsal jemu a ne sem." U odchozí delegace si uživatel aspoň může přečíst
výsledek u druhého bota. U příchozího požadavku od bota na assistenta ale žádný takový
záložní kanál není — pokud assistent odpoví jen zpátky botovi, uživatel se o té výměně
nedozví vůbec, ani zpětně.

Date:
2026-08-19

---

## `META_BOT.md`: konsolidovaný zápis architektury + konvencí pro budoucího meta-bota

→ viz personal/devbot/DECISIONS.md

---

## Uniklý OAuth token (15.9.) — ponechán aktivní, vědomé rozhodnutí

→ viz personal/devbot/DECISIONS.md

---

## Vlastní restartovací skripty mimo cron nesmí sám spouštět nový proces

→ viz personal/devbot/DECISIONS.md
