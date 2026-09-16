# DevBot — architektonická rozhodnutí

## Mount META_BOT.md/ARCHITEKTURA.md do denního kontejneru jen read-only (iterace 3)

**Decision:** `docker-compose.daily.yml` mountuje `META_BOT.md` a `ARCHITEKTURA.md`
z kořene repa do denního kontejneru jako `:ro` (read-only), ne `:rw`, jak byl
původní záměr specu iterace 3.

**Why:** Spec počítal s read-write mountem, protože `personal/assistant/CLAUDE.md`
ukládá assistentovi tyhle dokumenty při architektonických změnách i zapisovat.
Code review + přímé ověření (test inode před/po zápisu nástrojem `Edit`)
ale ukázaly, že rw mount jednotlivého souboru nesplní účel: `Edit` nepíše
in-place, ale přes tmp-soubor+rename, takže výsledek skončí na novém inode,
který bind mount jednotlivého souboru (vázaný na inode zachycený při startu
kontejneru, ne na cestu) vůbec nevidí — zápis by se tiše ztratil, nepropsal
by se na host. Read-write mount by tak vytvořil falešný pocit, že zápis
funguje, zatímco by tiše mizel.

**Alternatives:**
- Ponechat rw mount beze změny — zamítnuto, prokazatelně nefunkční pro hlavní
  účel (in-container editace), riziko tichého mizení dat.
- Přesunout oba soubory do vlastního adresáře a mountovat ten adresář celý
  (adresářové mounty přežijí i rename) — technicky správné řešení problému,
  ale zasahuje `bridge-ts/src` referencí (ověřeno gremem: 0, viz TASKS.md) a
  9 dalších `CLAUDE.md`/`DECISIONS.md` napříč boty, co soubory odkazují
  jménem — moc velký zásah na opravu uvnitř už schválené malé iterace.
  Odloženo jako samostatná budoucí iterace, viz `TASKS.md`.
- Mount celého kořene repa read-write — zamítnuto, zbytečně velký blast
  radius (celý zdrojový kód, ne jen 2 dokumenty) za cenu vyřešení stejného
  problému, co menší adresářový mount vyřeší bezpečněji.

**Date:** 2026-09-15
