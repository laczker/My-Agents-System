# Úkoly — backlog

Průběžný seznam rozhodnutých/otevřených úkolů pro `personal/zpravodaj`, aby se
nemuselo spoléhat na `chat_history.txt` (drží jen pár posledních výměn) ani na paměť
v rámci jedné session. Hotové položky se mažou nebo přesouvají do `DECISIONS.md`,
pokud šlo o architektonické rozhodnutí.

## Čeká na uživatele

- **AI novinky (deep research) + event-driven report** — obsahové zadání přišlo
  18.8. relayované přes `assistant-4a` (cross-session zpráva jménem uživatele), viz
  `DECISIONS.md`. Potřeba potvrdit přímo s uživatelem v tomhle chatu, než se
  implementuje: (1) jak monitorovat AI novinky + programátorská fóra (HN, r/programming)
  mimo pevný denní rytmus, (2) jak rozhodovat, co je "dost relevantní" na poslání
  reportu (event-driven, ne nucený denní), (3) jestli AI-news báze jede jako
  samostatný cron/skript vedle stávajícího `daily_digest.sh`, nebo se do něj vlije.

- **Potvrzení implementace proaktivního spouštění** — `bridge-ts` dnes reaguje jen na
  příchozí Telegram zprávy (`bot.on("message")`), žádný mechanismus, který by bota
  v 8:00 sám "probudil" bez zprávy od uživatele, zatím neexistuje. Původní návrh
  (přidat per-profil větev do sdíleného `bridge-ts/src/*`) uživatel zamítl —
  `assistant`/`zpravodaj`/`mailista` sice už dnes běží jako tři nezávislé OS procesy
  (viz `watchdog.sh`), ale zdrojový kód v `bridge-ts/src/` je pořád sdílený mezi
  všemi třemi, takže i profilem-gatovaná změna by do něj zasahovala zbytečně.
  Nová varianta: samostatný skript jen v `personal/zpravodaj/`, spouštěný vlastním
  řádkem v crontabu v 8:00 — zavolá `claude -p` s cwd v `personal/zpravodaj` a
  výsledek pošle přímo přes Telegram Bot API s tokenem z `.env.zpravodaj`. Nulový
  zásah do `bridge-ts/src/*`, žádný restart sdíleného enginu. Zatím neimplementováno
  na výslovné přání uživatele (17.8.) — čeká na pokyn k implementaci.

## Hotovo

- **Obsahové zadání** (17.8.) — zdroje, formát a čas domluveny s uživatelem, viz
  `DECISIONS.md`.
</content>
