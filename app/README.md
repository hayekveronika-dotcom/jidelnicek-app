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

## Data a synchronizace

- Data se ukládají v zařízení (IndexedDB) **a** synchronizují se přes server (Cloudflare Pages Functions + databáze D1). Telefon a počítač tak vidí totéž a aplikace funguje i offline. Změny se odešlou po připojení.
- Server drží celý stav jako jeden záznam s číslem verze. Když se data mezitím změnila na jiném zařízení, aplikace změny sloučí po jednotlivých pokrmech, surovinách, týdnech a položkách seznamu (`js/merge.js`). Pokud obě zařízení upravila totéž pole, vyhraje pozdější zápis. Zásoby mražených se sčítají jako rozdíly.
- Stav synchronizace je v menu `⋯` na obrazovce Jídelníček, kde je i *Synchronizovat teď*. Když vyprší přihlášení, nahoře se objeví lišta *Přihlásit*.
- *Importovat data* i *Smazat všechna data* přepíšou data **na všech zařízeních**.
- Server drží posledních 200 verzí (tabulka `app_state_history`), takže jde vrátit i nechtěná změna (viz níže).
- Lokálně (`python3 -m http.server`) server není, takže aplikace běží jen s daty v prohlížeči, jako dřív.
- Zálohy: menu `⋯` → *Exportovat data* / *Importovat data* (JSON).

## Nastavení serveru (Cloudflare, jednorázově)

Přístup chrání **Cloudflare Access**: před aplikací je přihlášení jednorázovým kódem na e-mail. API (`functions/api/`) navíc samo ověřuje podpis přihlášení.

1. **Databáze D1:** dashboard → *Storage & Databases* → *D1 SQL Database* → *Create* → název `jidelnicek`. Tabulky se založí samy při prvním požadavku.
2. **Propojení s Pages:** projekt `jidelnicek-app` → *Settings* → *Bindings* → *Add* → *D1 database*. *Variable name* = `DB`, databáze = `jidelnicek`.
3. **Cloudflare Access:** dashboard → *Zero Trust* (poprvé zvolte název týmu a plán *Free*) → *Access* → *Applications* → *Add an application* → *Self-hosted*:
   - *Application domain*: `jidelnicek-app.pages.dev`. Přidejte i druhý řádek `*.jidelnicek-app.pages.dev`, aby byly chráněné i náhledové adresy.
   - *Session duration*: např. 1 měsíc.
   - *Policy*: *Allow*, *Include* → *Emails* → váš e-mail (2. uživatel = přidat další e-mail).
   - Přihlašovací metoda: *One-time PIN* (výchozí).
4. **Proměnné:** v Access aplikaci zkopírujte *Application Audience (AUD) Tag*. Název týmu najdete v *Zero Trust → Settings* (`<tým>.cloudflareaccess.com`). Pak projekt Pages → *Settings* → *Variables and Secrets* → přidejte:
   - `ACCESS_TEAM_DOMAIN` = `<tým>.cloudflareaccess.com`
   - `ACCESS_AUD` = zkopírovaný AUD tag
5. **Nové nasazení:** *Deployments* → u posledního nasazení *Retry deployment* (nastavení se projeví až v novém nasazení).
6. **Kontrola:** otevřete aplikaci, přihlaste se kódem z e-mailu a v menu `⋯` by mělo být „Data se synchronizují mezi zařízeními“.

**Pořadí zařízení:** aplikaci se synchronizací otevřete nejdřív na zařízení, kde už máte data (nahrají se na server). Ostatní zařízení si je pak stáhnou. Pokud mají data obě zařízení, spojí se. Případné zdvojené suroviny jde sloučit ve *Správě surovin*.

**Obnova starší verze:** D1 → `jidelnicek` → *Console*:

```sql
SELECT rev, updated_at, updated_by FROM app_state_history ORDER BY rev DESC LIMIT 20;
-- vrácení verze 123 (vznikne nová verze se starými daty):
UPDATE app_state SET data = (SELECT data FROM app_state_history WHERE rev = 123), rev = rev + 1 WHERE id = 'main';
```

## Další zařízení bez přihlášení (tajný odkaz)

Cloudflare Access chrání jen data (`/api`), samotná aplikace se otevře bez přihlášení. Kdo není přihlášený ani připojený odkazem, dat se nedostane. V aplikaci uvidí lištu *Přihlásit*, která vede na přihlášení e-mailem.

Zařízení bez přihlášení (např. manželův telefon) se připojí **tajným odkazem** se servisním tokenem Access. Klíč si zařízení zapamatuje a posílá ho se synchronizací. Kdo odkaz zná, má přístup k datům, dokud token v Cloudflare nesmažete.

Nastavení (jednorázově, **až po nasazení této verze**):

1. Zero Trust → *Access* → *Service credentials* → *Service Tokens* → *Create Service Token*: název např. `manzel`, *Duration* *Non-expiring*. Zkopírujte **Client ID** a **Client Secret** (secret se zobrazí jen jednou).
2. Zero Trust → *Access* → *Applications* → `jidelnicek-app` → *Destinations*: u obou řádků (`jidelnicek-app.pages.dev` i `*.jidelnicek-app.pages.dev`) vyplňte *Path* `api` → *Save*.
3. Ve stejné aplikaci → *Access policies* → *Create new policy*: *Action* **Service Auth**, *Include* → **Service Token** → `manzel` → *Save*. Pak *Save* aplikace.
4. V aplikaci menu `⋯` → *Odkaz pro další zařízení* → vložte Client ID a Client Secret → *Vytvořit odkaz* → *Poslat odkaz*.
5. Na druhém zařízení otevřete odkaz v Safari (zařízení se připojí) a pak *Sdílet → Přidat na plochu*. Pokud aplikace z plochy hlásí „Odkaz pro toto zařízení už neplatí“ nebo nesynchronizuje, v ní menu `⋯` → *Připojit toto zařízení odkazem* → vložte odkaz.

Zrušení přístupu: smažte servisní token v Zero Trust. Odkaz přestane platit na všech zařízeních, která ho použila.

## Propojení s Claudem (konektor MCP)

Claude v claude.ai čte knihovnu, zásoby a jídelníčky a posílá **návrhy** (nový pokrm, surovina, obsazení dnů). Návrhy se objeví na obrazovce Jídelníček jako „Návrhy od Clauda“. Přijatý nový pokrm se rovnou otevře v editaci ke kontrole. Po *Přijmout* se návrhy provedou stejně, jako kdyby se zadaly ručně (kontrola duplicit, mražené zásoby, jídla podle dne). *Zamítnout* je zahodí.

Přístup chrání tajná část adresy `https://jidelnicek-app.pages.dev/mcp/<MCP_SECRET>`. Kdo ji zná, dostane se k datům, proto ji nikam nesdílejte. Když unikne, změňte `MCP_SECRET` a konektor v claude.ai přidejte znovu.

Nastavení (jednorázově):

1. Pages projekt → *Settings* → *Variables and Secrets* → *Add* → *Type* **Secret**, název `MCP_SECRET`, hodnota = náhodný řetězec (aspoň 32 znaků). Pak *Deployments* → *Retry deployment*.
2. Zero Trust → *Access* → *Applications* → *Add an application* → *Self-hosted*:
   - *Public hostname*: subdoména prázdná, doména `jidelnicek-app.pages.dev`, *Path* `mcp`;
   - *Policy*: *Action* **Bypass**, *Include* **Everyone**.
   (claude.ai se přes Access přihlásit neumí. Ochranu tu zajišťuje tajná adresa.)
3. claude.ai → *Settings* → *Connectors* → *Add custom connector* → název „Jídelníček“, URL `https://jidelnicek-app.pages.dev/mcp/<MCP_SECRET>`, *Advanced settings* nevyplňovat.
4. V chatu nebo projektu zapněte konektor (ikona nástrojů) a zkuste např. „Co mám v knihovně za snídaně?“.

Nástroje: `get_library`, `get_plans`, `list_proposals`, `propose_plan`, `propose_dish`, `propose_ingredient`, `withdraw_proposal`.

## Struktura

| Soubor | Obsah |
| --- | --- |
| `js/domain.js` | datový model a pravidla (týdny, sloty, mražené ±1, slučování nákupního seznamu, duplicity, sloučení surovin) |
| `js/pdf.js` | PDF jídelníčku A4 (canvas → JPEG → PDF) |
| `js/db.js` | ukládání v zařízení (IndexedDB, záložně localStorage) |
| `js/sync.js` | synchronizace se serverem (`/api/state`), stav v menu |
| `js/merge.js` | slučování změn ze dvou zařízení (čisté funkce) |
| `js/proposals.js` | návrhy od Clauda: kontrola (sdílí aplikace i server), přijetí/zamítnutí |
| `../functions/mcp/[secret].js` | MCP server pro Clauda (tajná adresa, jen návrhy) |
| `../server/store.js` | čtení/zápis stavu v D1 (sdílí API i MCP) |
| `../functions/api/` | server: ověření přihlášení (`_middleware.js`), čtení/zápis stavu v D1 (`state.js`) |
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
4. **Více pokrmů na slot** (např. svačina: rohlík s avokádem, mrkev, perník, para ořechy). Ve výběru se klepnutím pokrm přidá, dalším klepnutím odebere, sheet zůstává otevřený do „Hotovo“. U jednotlivého pokrmu ve dni jde *Nahradit* / *Odebrat*. Další pokrm do už vyplněného jídla se přidá klepnutím na pokrm → *Přidat další do tohoto jídla*.
5. **Zbytky:** stejný pokrm ve 2 slotech se počítá dvakrát.
6. **Volitelné údaje pokrmu:** čas přípravy, porce, Thermomix, omezení, postup/odkaz. Jsou ve sbalené sekci „Další údaje“. Fotka zatím není.
7. **Převody jednotek nejsou.** Množství v receptu, u samostatné suroviny ve dni i u ruční položky nákupu je vždy v jednotce suroviny (jednotka se nedá vybrat, mění se jen u suroviny ve *Správě surovin*). Starší recepty s jinou jednotkou jsou označené „k opravě jednotek“ (filtr *K opravě* v Knihovně). Dokud se neopraví, jsou na nákupním seznamu jako samostatný řádek.
8. **Řazení nákupu** podle kategorie suroviny. Odškrtnuté (nakoupené) položky jsou dole v jedné skupině *Nakoupeno*, podle abecedy.
9. **Mražený pokrm** není propojený s knihovnou. Při 0 ks je ve výběru zašedlý a nejde přiřadit. Po výběru se otevře okno s počtem (např. 2× perník = −2 ks z mrazáku); počet jde později změnit klepnutím na položku ve dni, rozdíl se odečte nebo vrátí do mrazáku.
10. **Filtr ve výběru pokrmu** jde zrušit (✕) a zase vrátit.

Další drobnosti:

- Ruční položky seznamu aktualizace nikdy nemaže. Stejná ruční surovina se sečte do jednoho řádku, ale od položek z jídelníčku se drží zvlášť.
- Položku nákupního seznamu jde smazat **přejetím doleva** (řádek zčervená, po přejetí přes polovinu se smaže). Smazání = „Vyřazeno – mám doma“: položka jde vrátit přes *Zobrazit*.
- **Množství na nákupním seznamu** jde upravit u každé položky (klepnutí na položku → *Upravit množství*). U položky z jídelníčku si aplikace pamatuje rozdíl proti jídelníčku: z 6 ks cibule upravených na 4 ks bude po přidání jídla s dalšími 2 ks zase 6 ks. Položka má označení „upraveno“. *Vrátit podle jídelníčku* úpravu zruší.
- Menu `⋯` → **Přidat vše na nákupní seznam**: přidá všechny suroviny z právě zobrazeného týdne znovu, i když už byly nakoupené, smazané nebo je seznam archivovaný (např. po smazání seznamu). Položky, které na seznamu už jsou, se nezdvojí.
- Spodní okna jde zavřít **přetažením dolů** (když je obsah okna odscrollovaný nahoru).
- Když aktualizace jídelníčku potřebuje smazanou položku, aplikace se zeptá **„Obnovit smazané položky?“**: *Ano* = smazané se vrátí na seznam (nakoupené zůstanou nakoupené), *Ne* = přidají se jen nové položky.
- Kontrola duplicit: normalizace (malá písmena, bez diakritiky, mezery) + Levenshteinova vzdálenost (1–3 podle délky) + shodný začátek slova. Na obrazovce Suroviny jde dvojici označit „Nejsou duplicity“.
- **Samostatné suroviny v jídelníčku:** ve výběru do slotu je záložka *Suroviny* (vyhledávání, kontrola duplicit, vytvoření nové). Množství je nepovinné a jde upravit klepnutím na položku ve dni. Na nákupní seznam se propisuje s poznámkou „samostatně v jídelníčku“ a sčítá se se stejnou surovinou z pokrmů.
- **Sdílení jídelníčku (PDF A4):** ikona sdílení vpravo nahoře na Jídelníčku. *Odeslat PDF e-mailem* otevře systémové sdílení telefonu (vyberte Mail/Gmail, PDF je v příloze). Kde prohlížeč sdílení souborů neumí (část desktopových prohlížečů), PDF se stáhne a přiloží se ručně. PDF se generuje přímo v aplikaci (`js/pdf.js`, bez knihoven, funguje i offline); text v PDF je obrázek, nejde z něj kopírovat.
- Výběr pokrmu do slotu je na celou výšku obrazovky. Při hledání se schová popis a výsledky jsou hned pod polem hledání (nad klávesnicí). *+ Vytvořit nový pokrm* je pak až pod výsledky.
- Ve výběru pokrmu do slotu je tlačítko *+ Vytvořit nový pokrm*: otevře nový pokrm s předvyplněným štítkem slotu a po uložení ho rovnou přidá do daného dne.
- Smazaný pokrm jde obnovit (Knihovna → Smazané pokrmy).
- Ve výběru pokrmu je u každého pokrmu „naposledy“ (kdy byl naposledy v jídelníčku) kvůli obměně.
