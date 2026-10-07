# Otevřené úkoly — Trenér

## Lukášovy cíle/milníky (kontext, ne úkoly pro agenta)

- **Váha**: první meta 90 kg (z 97 kg, zadáno 2026-09-22).
- **Běh**: uběhnout půlmaraton (21,1 km) do 30 let (zadáno 2026-09-22).
  30. narozeniny **30.8.2027** — cca 11 měsíců na přípravu od zadání cíle.
  Momentální strop běhu je cca 10 km v tempu lehce přes 6 min/km — do
  půlmaratonu je to jak v distanci (přes dvojnásobek), tak časem i tempo,
  takže reálný postupný nájezd (ne že by se do toho mělo házet najednou).
  Až Lukáš bude chtít, dá se z tohodle poskládat orientační tréninkový plán
  (postupné navyšování km/týden) — zatím jen cíl+deadline zapsané, plán
  nerozpracovávat samo od sebe.


- **Strava/Garmin napojení** (odloženo) — Lukáš o to má zájem do budoucna, ale
  zatím zůstává jen ruční zápis sportu. Zvážit až se ukáže, že ruční zápis
  nestačí/je otravný. Vyžaduje OAuth + nový token v `.env.trener`, není triviální
  rozšíření.

- **Sledování tréninkového pokroku (běh, lezení)** (2026-09-22, upřesněno) —
  - **Běh**: chce hlavně sledovat trend tempa. Momentální strop cca 10 km,
    tempo lehce přes 6 (min/km). Tempo lze zatím spočítat z existujících polí
    `vzdalenost_km`/`doba_min` u `sport` záznamů — nepotřebuje nové pole ve
    schématu, jen důsledně zapisovat obě hodnoty u běhu. Při shrnutí/na
    vyžádání umím spočítat tempo jednotlivých běhů a trend v čase.
  - **Lezení**: cíl je hlavně zhubnout a vrátit se k nějakému progresu — teď
    zanedbáváno, cca 1x týdně. Zatím nemá konkrétní metriku (stupeň
    obtížnosti/styl nezmínil) — pro začátek stačí sledovat frekvenci
    (kolikrát týdně/měsíčně) z existujících záznamů, konkrétnější metrika
    (obtížnost apod.) až řekne.
  - Nerozšiřovat schéma `log.json` ani nezačínat nic dalšího samo od sebe,
    dokud si Lukáš sám neřekne o konkrétní přehled/graf.
