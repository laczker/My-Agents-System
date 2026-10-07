# AI Agent System — pracovní návrh architektury

> Osobní AI infrastruktura pro vývoj více projektů, research a osobní úkoly. Člověk zůstává hlavním rozhodovatelem a reviewerem.

## 1. Základní koncept
Nechci jednoho „superagenta“, kterému dám všechno. Chci jednu společnou infrastrukturu a nad ní izolované projekty a specializované agenty.

## 2. Základní technologie
- Claude Code
- server / VM
- Git + GitHub/GitLab
- jednotlivé repositories / workspaces
- automatizované testy
- jednoduchý orchestrátor

## 3. Projektoví agenti
- Product Agent
- Research Agent
- Developer Agent
- Code Reviewer Agent
- QA Agent
- Debugging Agent
- UX/UI Agent
- Release Agent

## 4. Vývojový workflow
Idea -> Product Spec -> Developer -> Tests/Lint -> Code Review -> QA -> Human Review -> DONE

## 5. Human-in-the-loop
Chci aktivně číst AI-generated kód a učit se.

## 6. Projekty
projects/ (FB Albums, Dentist Reviews, atd.)

## 7. Opportunity / Idea Scout
Samostatný agent pro hledání potenciálních projektů s důkazy poptávky.

## 8. Personal agents
personal/ (Assistant, Real Estate, Investments)

## 9. Permissions / isolation
Agenti nemají mít automaticky přístup ke všemu.

## 10. Orchestrator
Přijme task, vybere agenta, předá context, sleduje stav.

Reálný stav (2026-08-19): žádný orchestrátor v tomhle smyslu zatím neběží — delegace
dnes dělá Assistant sám přes `SendMessage` mezi třemi samostatnými `bridge-ts`
procesy (assistant, zpravodaj, mailista). Jak to skutečně funguje a jaké konvence
si to vynutilo (delegační protokol, jazyk, alerting, sdílené vs. izolované zdroje) je
zapsané v `META_BOT.md` — určeno jako startovní bod pro budoucího meta-bota (bota,
co bude sám zakládat/spouštět další boty), ať neobjevuje stejná pravidla znovu přes
stejné incidenty.

## 11. Paralelní práce
Maximalizovat užitečný výstup na jednotku času.

## 12. Scheduler
Pravidelné ranní přehledy a týdenní research.

## 13. Persistent context / memory
Každý projekt má README.md, PRODUCT.md, ARCHITECTURE.md, DECISIONS.md.

## 14. Git / review model
Issue -> branch -> implementation -> tests -> PR -> AI review -> human review -> merge.

## 15. Kritické pravidlo pro autonomii
Vysoká autonomie pro research/testy/návrhy. Nízká pro prod deploy, mazání a peníze.

## 16. Doporučená první verze
Minimum: Claude Code + Git + Project folders + Agent instruction files + Tests.

## 17. První cíl
Task -> agent -> implementace -> review -> testy -> můj review -> hotovo.

## 18. Dlouhodobá vize
AI Studio řízené člověkem.

## 19. Hlavní principy
Simple first, Agent specialization, Human in the loop, Persistent context, Project isolation.

## 20. Konečná vize
Systém, který multiplikuje čas a umožňuje provozovat více projektů.
