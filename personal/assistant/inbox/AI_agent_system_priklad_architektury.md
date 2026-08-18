# AI Agent System — pracovní návrh architektury

> Osobní AI infrastruktura pro vývoj více projektů, research a osobní úkoly. Člověk zůstává hlavním rozhodovatelem a reviewerem.

## 1. Základní koncept

Nechci jednoho „superagenta“, kterému dám všechno. Chci jednu společnou infrastrukturu a nad ní izolované projekty a specializované agenty.

```text
                         AI HUB
                           │
              ┌────────────┴────────────┐
              │                         │
          PROJECTS                    PERSONAL
              │                         │
       ┌──────┼──────┐          ┌───────┼────────┐
      HabitPet   FB   Dental   Assistant Reality Investments
```

AI má dělat co nejvíce práce, ale:
- důležitá rozhodnutí schvaluji já,
- chci číst AI-generated kód,
- chci se díky review zlepšovat,
- nechci slepě deployovat AI-generated software,
- agenti mají mít omezená oprávnění podle role.

## 2. Základní technologie

První verze nemusí být složitá:

- Claude Code
- server / VM
- Git + GitHub/GitLab
- jednotlivé repositories / workspaces
- automatizované testy
- jednoduchý orchestrátor
- později scheduler

Na začátku nechci zbytečně stavět Kubernetes, složitou message queue, vlastní komplikovaný framework ani desítky mikroservis. Architektura má růst podle reálných potřeb.

## 3. Projektoví agenti

### Product Agent
- specifikace feature
- acceptance criteria
- scope
- rozdělení práce
- product dokumentace

### Research Agent
- research trhu
- konkurence
- uživatelské problémy
- technické možnosti
- ověřování hypotéz

### Developer Agent
- implementace
- refactoring
- testy
- práce s repository

### Code Reviewer Agent
- review změn
- bugy
- architektura
- maintainability
- security
- performance
- best practices

Nemá pouze říkat „LGTM“, ale aktivně hledat problémy.

### QA Agent
- unit/integration/E2E testy
- edge cases
- regresní scénáře
- acceptance criteria

### Debugging Agent
- analyzovat failing test
- reprodukovat problém
- najít root cause
- opravit a ověřit

### UX/UI Agent
- obrazovky
- UX flow
- design systém
- konzistence UI
- assety

### Release Agent
Později buildy, release checklist, store metadata a deployment. Produkční release má vyžadovat schválení.

## 4. Vývojový workflow

```text
Idea
 ↓
Product Agent
 ↓
Specification + Acceptance Criteria
 ↓
Developer Agent
 ↓
Implementation
 ↓
Lint / Typecheck
 ↓
Automated Tests
 ↓
Code Reviewer
 ↓
QA
 ↓
Fixes if needed
 ↓
Re-review
 ↓
Human Review
 ↓
DONE
```

Feature není hotová jen proto, že agent napsal kód.

Musí:
- splnit acceptance criteria,
- projít typecheck/lint,
- projít testy,
- projít code review,
- projít QA,
- být schválena člověkem.

## 5. Human-in-the-loop

Chci aktivně číst AI-generated kód a učit se.

Užitečné otázky pro agenta:
- „Proč jsi použil tento pattern místo varianty B?“
- „Jaké jsou trade-offs?“
- „Vysvětli mi tuto část jako senior developer.“
- „Najdi v tomto PR problém, který by junior přehlédl.“

Cílem není jen rychlost, ale také zlepšování vlastního engineering skillu.

## 6. Projekty

```text
projects/
├── habitpet/
├── fb-albums/
└── dentist-reviews/
```

Každý projekt má vlastní:
- repository
- product context
- dokumentaci
- agent configuration
- testy
- backlog

Agenti nesmí automaticky míchat kontext mezi projekty.

### HabitPet
Mobilní habit tracker s virtuálním mazlíčkem, gamifikací a evolucí. Později možná browser extension.

### FB Albums
Aplikace pro vytváření alb z historických Facebook konverzací. Oblasti: import/export dat, parsing, fotky, timeline, generování alb, privacy.

### Dentist Reviews
Platforma pro recenze pracovišť / zaměstnavatelů v oblasti zubařství. Důležité oblasti: research trhu, anonymita, moderace, falešné recenze, právní rizika, monetizace.

## 7. Opportunity / Idea Scout

Samostatný agent pro hledání dalších potenciálních projektů.

Nemá generovat náhodných 100 startup ideas. Má hledat reálné problémy, které lidé už řeší a potenciálně za jejich řešení zaplatí.

Možné zdroje:
- Reddit
- App Store / Google Play recenze
- Product Hunt
- Indie Hackers
- GitHub
- Chrome Web Store
- fóra a diskuse
- recenze existujících produktů
- trendy a search interest

Workflow:

```text
Collect
 ↓
Detect recurring problems
 ↓
Generate opportunities
 ↓
Research competition
 ↓
Validate demand
 ↓
Estimate monetization
 ↓
Estimate MVP difficulty
 ↓
Score
 ↓
TOP opportunities
 ↓
Human decision
```

Výstup má obsahovat například:

```text
Problem:
Existing solutions:
Evidence of demand:
Competition:
Potential differentiation:
MVP complexity:
Monetization:
Distribution:
Solo-developer feasibility:
Score:
```

## 8. Personal agents

Vedle projektových agentů chci osobní agenty:

```text
personal/
├── assistant/
├── real-estate/
├── investments/
└── ...
```

### Personal Assistant

Centrální agent, který:
- shrnuje stav ostatních agentů,
- upozorňuje na důležité věci,
- připravuje denní/týdenní přehled,
- deleguje úkoly,
- spojuje výsledky více agentů.

Příklad:

```text
🏠 Reality
3 nové nabídky odpovídají kritériím.

📈 Investments
Nové výsledky sledované společnosti.

🐾 HabitPet
Dokončený habit creation flow. Čeká na review.

📖 FB Albums
Research potvrdil dostupnost potřebných dat.

🦷 Dentist Reviews
Nalezeny relevantní konkurenční produkty.
```

### Real-estate Research Agent
- sleduje nabídky
- filtruje podle kritérií
- sleduje změny cen
- porovnává nabídky
- hledá zajímavé příležitosti
- připravuje shortlist

### Investment Research Agent
- sleduje vybrané společnosti / ETF / trhy
- čte výsledky
- sleduje relevantní zprávy
- porovnává valuace
- hledá rizika
- připravuje research

Nemá autonomně obchodovat. Má poskytovat informace a analýzu pro lidské rozhodnutí.

## 9. Permissions / isolation

Agenti nemají mít automaticky přístup ke všemu.

```text
Assistant
 ├── read → project status
 ├── read → research summaries
 └── delegate → selected agents

Real Estate Agent
 └── access → real-estate workspace

Investment Agent
 └── access → investment workspace

Project Developer
 └── access → only assigned project repository
```

Citlivé informace a credentials mají být oddělené.

## 10. Orchestrator

Orchestrátor:
- přijme task,
- vybere agenta,
- předá potřebný context,
- sleduje stav,
- spouští další krok,
- řeší retry,
- zastaví workflow při chybě,
- vyžádá human approval, když je potřeba.

První verze může být velmi jednoduchá.

## 11. Paralelní práce

Mohu mít mnoho agentů definovaných, ale nemusím mít mnoho agentů aktivních současně.

Například:

```text
Project A → coding
Project B → research
Project C → waiting
Personal → scheduled research
```

Bottleneck nebude jen CPU. Důležité budou:
- model/API limity
- tokeny
- cena
- kvalita kontextu
- schopnost člověka reviewovat výstupy

Nechci maximalizovat počet agentů. Chci maximalizovat užitečný výstup na jednotku svého času.

## 12. Scheduler

Někteří agenti mohou běžet pravidelně:

```text
Every morning:
- assistant summary

Every Sunday:
- Idea Scout

Every day:
- real-estate research

Periodic:
- investment research
```

Výsledky se mají ukládat jako reporty/artefakty, aby se k nim dalo později vrátit.

## 13. Persistent context / memory

Každý projekt by měl mít vlastní kontext:

```text
project/
├── README.md
├── PRODUCT.md
├── ARCHITECTURE.md
├── DECISIONS.md
├── ROADMAP.md
├── agents/
└── docs/
```

Důležitá rozhodnutí ukládat například:

```text
Decision:
Use Expo / React Native.

Why:
...

Alternatives:
...

Date:
...
```

Cílem je zachovat technologická, produktová a architektonická rozhodnutí napříč sessions.

## 14. Git / review model

Každá větší práce:

```text
Issue
 ↓
branch / worktree
 ↓
agent implementation
 ↓
tests
 ↓
PR
 ↓
AI review
 ↓
human review
 ↓
merge
```

Agenti by pokud možno neměli bez kontroly měnit hlavní branch.

## 15. Kritické pravidlo pro autonomii

Vysoká autonomie je vhodná pro:
- research
- analýzu
- návrhy
- testování
- lokální opravy
- dokumentaci

Nízká autonomie pro:
- produkční deployment
- mazání dat
- práci s penězi
- publikaci do store
- změny security nastavení
- zásadní produktová rozhodnutí
- přístup k citlivým datům

Tyto akce vyžadují human approval.

## 16. Doporučená první verze

Minimum:

```text
Claude Code
+
Git
+
Project folders
+
Agent instruction files
+
Basic orchestrator
+
Tests
+
Code review
```

První agenti:

```text
1. Product
2. Developer
3. Reviewer
4. QA
5. Research
6. Assistant
```

Později:
- Idea Scout
- Real Estate
- Investments
- UX/UI
- Release
- další specializovaní agenti

## 17. První cíl

Nechci nejdřív postavit perfektní AI platformu.

První cíl:

> **Task → agent → implementace → review → testy → můj review → hotovo.**

Jakmile tento loop funguje spolehlivě, systém může růst.

## 18. Dlouhodobá vize

```text
                 MY AI STUDIO
                      │
       ┌──────────────┼──────────────┐
       │              │              │
   BUILD PRODUCTS   RESEARCH      PERSONAL
       │              │              │
   ┌───┼───┐       ┌──┼──┐       ┌──┼──┐
   │   │   │       │  │  │       │  │  │
 Habit  FB Dental Ideas Market  Realty Invest
       │
       ▼
  AI development team
       │
       ▼
  Tests + Reviews
       │
       ▼
  Human approval
       │
       ▼
  Real products
```

## 19. Hlavní principy

1. **Simple first** — komplexitu přidávat až podle potřeby.
2. **Agent specialization** — specializované role místo jednoho superagenta.
3. **Human in the loop** — člověk zůstává rozhodovatelem.
4. **Review over blind automation** — rychlost nesmí převážit kvalitu.
5. **Persistent context** — důležitá rozhodnutí musí přežít jednotlivé sessions.
6. **Project isolation** — projekty nesmí náhodně míchat kontext.
7. **Evidence over hype** — Idea Scout hledá důkazy poptávky.
8. **Build small, validate early** — každý produkt má rychle získat malý experiment/MVP.
9. **AI works, human decides** — agent může pracovat autonomně, ale zásadní rozhodnutí schvaluje člověk.

## 20. Konečná vize

Cílem není mít co největší počet agentů.

Cílem je vytvořit systém, který **multiplikuje několik hodin mého času týdně** a umožní mi současně:

- stavět vlastní produkty,
- objevovat nové příležitosti,
- dělat kvalitní research,
- učit se software engineering,
- automatizovat opakující se osobní úkoly,
- dlouhodobě provozovat více projektů bez toho, aby každý vyžadoval moji plnou pozornost.
