# Vision — cílový stav

Jiná kategorie než `DECISIONS.md` (tam jsou rozhodnutí, která už padla a platí) a jiná
než `MEMORY.md` (krátké fakty o uživateli). Sem patří to, kam to má podle uživatele
směřovat — aspirace, ne aktuální stav a ne odsouhlasený plán s krokama. Než se něco
z tohohle skutečně začne stavět, je to jen zápis záměru.

## Zdroj

Uživatel sdílel prezentaci o multi-agent systému (Hermes, Claude Code, Antigravity,
AgentsMonitoring, Agent2Telegram, sdílený "3D mozek" přes pgvector/MCP — viz
`inbox/AI_agent_system_priklad_architektury.md` a `chat_history.txt` 2026-08-17) a
17.8.2026 potvrdil, že tohle je zamýšlený **cílový stav** pro tenhle systém, ne jen
inspirace k diskusi.

## Co uživatel chce směrem k cíli

- **Ovládání přes hlas** — zatím žádný voice vstup/výstup není zapojený (bridge.py řeší
  jen textový Telegram kanál). V prezentaci jako kandidáti zmíněné Whisper (lokální,
  zdarma) a ElevenLabs Scribe (kvalitnější čeština, plně API-ovladatelné).
- **Monitoring** — dohled nad tím, co agent(i) dělají / jestli běží v pořádku
  (v prezentaci: AgentsMonitoring + samooprava, noční bezpečnostní audit s ranním
  reportem).
- **Verzování do gitu** — tenhle adresář (`personal/assistant`) zatím není git repo.
  Uživatel to zmínil jako "asi bych začal" — není to ještě potvrzené zadání, jen záměr.

## Co z toho NENÍ rozhodnuté ani odsouhlasené

Explicitně zamítnuto v `DECISIONS.md` (2026-08-17): stavět plnohodnotný memory systém
(embeddings/retrieval, sdílený "3D mozek" mezi agenty) hned teď — žádný current use case
to nevyžaduje. Tohle zamítnutí se týká *implementace teď*, ne cílového stavu jako takového
— pokud časem přibudou další agenti a reálná potřeba sdílet mezi nimi paměť, patří to sem
jako kandidát, ne rovnou do kódu.

Žádný z bodů výše nemá zatím konkrétní plán, timeline ani přiřazenou prioritu. Až se
některý z nich promění ve skutečné rozhodnutí (co konkrétně a jak), patří to rozhodnutí
do `DECISIONS.md`, tenhle soubor zůstává seznamem záměrů.

Date: 2026-08-17
