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
