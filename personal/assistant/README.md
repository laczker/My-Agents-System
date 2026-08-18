# Personal Assistant

Osobní centrální agent podle sekce 8 `ARCHITEKTURA.md`. Jediný agent, který je dnes
reálně zapojený přes Telegram bridge (`bridge.py`, běží s `cwd` v tomto adresáři).

## Soubory

- `CLAUDE.md` — trvalé instrukce agenta, automaticky načítané Claude Code při každém
  spuštění (řeší mezeru z sekce 13 — perzistentní kontext napříč sessions).
- `DECISIONS.md` — log důležitých rozhodnutí (technických, produktových,
  architektonických), formát: Decision / Why / Alternatives / Date.
- `chat_history.txt` — provozní log konverzace, spravuje ho `bridge.py` (drží se jen
  posledních `HISTORY_EXCHANGES` výměn Uživatel/Claude, není to náhrada za `DECISIONS.md`
  ani `MEMORY.md`).
- `MEMORY.md` — trvalé fakty a preference o uživateli/kontextu, doplňované průběžně,
  jen když se objeví něco, co stojí za zapamatování napříč sessions.
- `VISION.md` — cílový stav podle uživatele (hlasové ovládání, monitoring, verzování
  do gitu, ...). Aspirace, ne odsouhlasený plán — až se něco z toho reálně rozhodne
  implementovat, zápis rozhodnutí patří do `DECISIONS.md`.
- `inbox/` — soubory poslané uživatelem přes Telegram.

## Stav

Orchestrátor (sekce 10) zatím neexistuje — `bridge.py` dělá jedno `claude -p` volání
bez stavového sledování, retry logiky nebo routování na jiné agenty. Product, Developer,
Reviewer, QA a Research agenti (sekce 16) zatím nemají vlastní instrukční soubory, protože
je nemá kdo spustit. Založí se, až vznikne konkrétní projekt a orchestrátor, který je umí
zavolat.
