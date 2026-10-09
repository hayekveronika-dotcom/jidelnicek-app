# Jídelníček App

Mobilní PWA podle zadání `Jídelníček App – zadání.md` a 10 obrazovek ve složce `screens/`.
Čisté HTML/CSS/JS bez frameworku a bez build kroku.

## Spuštění

Service worker (offline režim, instalace na plochu) potřebuje web server, nestačí otevřít `index.html` z disku.

**Lokálně na počítači:**

```bash
cd app
python3 -m http.server 8080
# otevřít http://localhost:8080
```

**Na telefonu:** složku `app/` nahrajte na libovolný statický hosting s HTTPS (např. GitHub Pages, Netlify Drop, Cloudflare Pages). Na telefonu otevřete adresu a zvolte *Přidat na plochu*.

## Nasazení (GitHub + Cloudflare Pages)

1. Na GitHubu založte repozitář (může být soukromý) a nahrajte do něj složku `app/` (v kořeni repozitáře tedy bude `app/index.html` atd.).
2. Cloudflare dashboard → *Workers & Pages* → *Create* → záložka *Pages* → *Connect to Git* → vyberte repozitář.
3. Nastavení buildu: *Framework preset* = None, *Build command* = prázdné, *Build output directory* = `app`.
4. *Save and Deploy*. Aplikace poběží na `https://<název>.pages.dev`. Každý další commit do hlavní větve se nasadí sám.
5. Na telefonu otevřete adresu a zvolte *Přidat na plochu*.

Soubor `_headers` zajistí, že se `sw.js`, `index.html` a manifest necachují, takže se nová verze načte hned.

## Data

- Data jsou v IndexedDB **jen v daném prohlížeči a zařízení**. Telefon a počítač nesdílí data.
- Zálohy jsou v menu `⋯` na obrazovce Jídelníček: *Exportovat data* / *Importovat data* (JSON).
- Entity mají vlastní ID (suroviny, pokrmy, mražené, jídelníčky, nákupní seznamy), takže přechod na server (sdílení pro 2. uživatele, zápis z Claude projektu) znamená vyměnit `js/db.js`. Logika zůstává v `js/domain.js`.

## Struktura

| Soubor | Obsah |
| --- | --- |
| `js/domain.js` | datový model a pravidla (týdny, sloty, mražené ±1, slučování nákupního seznamu, duplicity, sloučení surovin) |
| `js/pdf.js` | PDF jídelníčku A4 (canvas → JPEG → PDF) |
| `js/db.js` | ukládání (IndexedDB, záložně localStorage) |
| `js/app.js` | obrazovky a ovládání |
| `css/app.css` | vzhled podle návrhů |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |

Po úpravě souborů zvyšte `VERSION` v `sw.js`, aby se telefonům načetla nová verze.

## Rozhodnutí k otevřeným otázkám (výchozí nastavení)

1. **„Nákup již proběhl“** platí po tlačítku [Nakoupeno], nebo když jsou odškrtnuté všechny položky. Pak tlačítko na jídelníčku ukáže dialog:
   - *Vytvořit nový nákupní seznam*: archivuje současný seznam a nový obsahuje jen rozdíl (co ještě nebylo nakoupeno ani vyřazeno);
   - *Všechno mám*: seznam se nemění, změna se bere jako pokrytá.
   - Pro jídelníček, který na seznamu ještě nebyl, je místo „Všechno mám“ volba *Přidat do současného seznamu*.
2. **Odškrtnutá položka** zůstává na seznamu, i když se pokrm z jídelníčku odebere.
3. **Archivace týdne** probíhá automaticky v pondělí (při otevření aplikace). V menu `⋯` je navíc *Uzavřít aktuální týden ručně*. Prázdné týdny se nearchivují.
4. **Více pokrmů na slot** (např. svačina: rohlík s avokádem, mrkev, perník, para ořechy). Ve výběru se klepnutím pokrm přidá, dalším klepnutím odebere, sheet zůstává otevřený do „Hotovo“. U jednotlivého pokrmu ve dni jde *Nahradit* / *Odebrat*.
5. **Zbytky:** stejný pokrm ve 2 slotech se počítá dvakrát.
6. **Volitelné údaje pokrmu:** čas přípravy, porce, Thermomix, omezení, postup/odkaz. Jsou ve sbalené sekci „Další údaje“. Fotka zatím není.
7. **Převody jednotek nejsou.** Stejná surovina v různých jednotkách = samostatné řádky.
8. **Řazení nákupu** podle kategorie suroviny.
9. **Mražený pokrm** není propojený s knihovnou. Při 0 ks je ve výběru zašedlý a nejde přiřadit. Po výběru se otevře okno s počtem (např. 2× perník = −2 ks z mrazáku); počet jde později změnit klepnutím na položku ve dni, rozdíl se odečte nebo vrátí do mrazáku.
10. **Filtr ve výběru pokrmu** jde zrušit (✕) a zase vrátit.

Další drobnosti:

- Ruční položky seznamu aktualizace nikdy nemaže. Stejná ruční surovina se sečte do jednoho řádku, ale od položek z jídelníčku se drží zvlášť.
- Položka „Vyřazeno – mám doma“ se znovu nepřidá. Jde ji vrátit přes *Zobrazit*.
- Kontrola duplicit: normalizace (malá písmena, bez diakritiky, mezery) + Levenshteinova vzdálenost (1–3 podle délky) + shodný začátek slova. Na obrazovce Suroviny jde dvojici označit „Nejsou duplicity“.
- **Samostatné suroviny v jídelníčku:** ve výběru do slotu je záložka *Suroviny* (vyhledávání, kontrola duplicit, vytvoření nové). Množství je nepovinné a jde upravit klepnutím na položku ve dni. Na nákupní seznam se propisuje s poznámkou „samostatně v jídelníčku“ a sčítá se se stejnou surovinou z pokrmů.
- **Sdílení jídelníčku (PDF A4):** ikona sdílení vpravo nahoře na Jídelníčku. *Odeslat PDF e-mailem* otevře systémové sdílení telefonu (vyberte Mail/Gmail, PDF je v příloze). Kde prohlížeč sdílení souborů neumí (část desktopových prohlížečů), PDF se stáhne a přiloží se ručně. PDF se generuje přímo v aplikaci (`js/pdf.js`, bez knihoven, funguje i offline); text v PDF je obrázek, nejde z něj kopírovat.
- Ve výběru pokrmu do slotu je tlačítko *+ Vytvořit nový pokrm*: otevře nový pokrm s předvyplněným štítkem slotu a po uložení ho rovnou přidá do daného dne.
- Smazaný pokrm jde obnovit (Knihovna → Smazané pokrmy).
- Ve výběru pokrmu je u každého pokrmu „naposledy“ (kdy byl naposledy v jídelníčku) kvůli obměně.
