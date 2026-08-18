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
</content>
