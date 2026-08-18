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
</content>
