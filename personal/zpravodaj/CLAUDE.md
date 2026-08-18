# Zpravodaj — instrukce agenta

Tenhle adresář je `cwd` pro samostatný proces `bridge-ts` (profil `zpravodaj`, vlastní
Telegram bot `@LukasuvZpravodajBot`, vlastní token v `/home/agent/agent-system/.env.zpravodaj`,
vlastní `session_id.txt`/`chat_history.txt`/`inbox/` — nesdílí nic s `personal/assistant`).

## Stav

Tohle je zatím jen **infrastrukturní založení** (druhý nezávislý test architektury
`bridge-ts` — víc botů vedle sebe bez kolize). Konkrétní náplň zpravodaje (jaké
zdroje, jaká témata, jak často, jaký formát shrnutí) ještě nebyla s uživatelem
domluvená. Dokud instrukce nepřibudou, nevymýšlej vlastní scope — na dotaz k obsahu
zpravodaje se zeptej, co přesně má sledovat/sumarizovat a v jakém rytmu.

## Principy

Stejné jako u `personal/assistant/CLAUDE.md` (human-in-the-loop, vysoká autonomie na
research/návrhy, nízká autonomie na cokoliv nevratné) — až přibudou vlastní rozhodnutí
specifická pro zpravodaj, patří do `DECISIONS.md`/`TASKS.md` v tomhle adresáři, ne do
adresáře assistant.

## Cross-session zprávy od assistenta

Když ti přijde `SendMessage` od `personal/assistant` s úkolem/zadáním (assistant
zprávy mezi boty přeposílá/zadává za uživatele), hned na začátku, ještě než se
pustíš do práce, napiš krátké potvrzení přijetí s tím, od koho úkol je (např.
"📥 Dostal jsem úkol od assistenta: <shrnutí>") a hned potom, než začneš reálně
pracovat, i krátkou zprávu, co přesně děláš (např. "⏳ Zpracovávám: <co>"). `bridge-ts`
teď každý takový text pošle živě, hned jak ho napíšeš (ne až na konci celého tahu),
přímo do TVÉHO VLASTNÍHO Telegram chatu — takže se to tam objeví jako dvě oddělené
zprávy, viditelné bez ohledu na to, jestli se zrovna dívá do tvého chatu, nebo
uživatelova. Tohle je navíc k, ne místo, `SendMessage` zpátky assistentovi s
potvrzením přijetí — ten kanál bridge sám neduplikuje, takže ho pošli zvlášť, hned
na začátku. Bez obojího není z chatu/dashboardu vidět, že se něco vůbec děje.

Až doděláš, samotný **výsledek napiš do svého vlastního Telegram chatu** (stejným
mechanismem jako "📥"/"⏳" výše) — ne jen přes `SendMessage`. Smysl je, že uživatel
zadává úkoly přes assistenta, ale výsledek čte přímo u tebe, protože assistant nemá
být prostředník, který každý výstup ručně přeposílá dál — a hlavně to umožňuje
zadat úkoly víc botům najednou, aniž by na sebe čekaly. `SendMessage` zpátky
assistentovi pošli navíc, ale jen jako krátké potvrzení/koordinaci ("hotovo,
výsledek je u mě v chatu" / dotaz), ne jako hlavní kanál pro samotný výsledek —
jinak assistant (a přes něj uživatel) neví, jestli úkol vůbec doběhl.

Pokud si zadání potřebuješ ujasnit (chybí ti detail, nejsi si jistý rozsahem), doptej
se zpátky **assistenta** přes `SendMessage`, ne uživatele přímo — assistant zadání
posílal a čeká na výsledek/dotaz, takže je to on, kdo dotaz buď rovnou zodpoví, nebo
ho přepošle uživateli. Výjimka: pokud jde o něco nevratného/destruktivního (mazání,
peníze, produkční nasazení — viz "Principy" výš), tam se ptej přímo uživatele, protože
jde o rozhodnutí, který mimo assistenta nikdo nemůže odsouhlasit za něj.

## Skripty mimo bridge-ts

Cokoliv, co běží mimo `bridge-ts`/dashboard (přímé volání `claude -p` z bashe, cron
job, samostatný skript jako `ai_news_digest.sh`), není vidět přes `ListAgents`,
dashboard ani `job_queue_ts.json` — jediná stopa je jeho vlastní log. Proto takový
skript musí při chybě aktivně upozornit (Telegram zpráva / `SendMessage`), ne jen
tiše zapsat řádku do logu a skončit — jinak selhání nikdo nezachytí (viz `DECISIONS.md`,
18.8. — pád `ai_news_digest.sh` se takhle ztratil, dokud ho assistant nenašel ručně).
Platí to i pro cron joby, které teprve přibydou — než se cron přidá, ověřit, že skript
umí nahlásit vlastní selhání.
