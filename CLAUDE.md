# Jídelníček App – kontext pro Claude Code

Rodinná PWA pro plánování jídelníčku. Uživatelka: Veronika (komunikace česky, stručně, prakticky; nejasnosti se ptát, nedomýšlet).
Zadání: `docs/zadani.md`, návrhy obrazovek: `docs/screens/` (10 obrazovek, mobil 390 px). Uživatelská dokumentace a přijatá rozhodnutí: `app/README.md`.

## Stav (10/2026)

- Hotová PWA ve `app/`: čisté HTML/CSS/JS (ES moduly), bez frameworku a bez build kroku. UI je česky.
- Data jen lokálně v prohlížeči (IndexedDB přes `app/js/db.js`), záloha export/import JSON v menu `⋯`.
- Nasazení: GitHub `hayekveronika-dotcom/jidelnicek-app` → Cloudflare Pages (Build output directory = `app`, žádný build command). Commit do `main` = nasazení.

## Architektura

- `app/js/domain.js` – veškerá pravidla a datový model (čisté funkce nad `state`, bez DOM). Každý zápis musí jít přes tyto funkce – stejná pravidla budou platit pro externí zápis (Claude/MCP).
- `app/js/app.js` – UI: hash router (`#/plan`, `#/library`, `#/dish/:id`, `#/frozen`, `#/shop`, `#/archive`, `#/ingredients`), render přes template stringy, delegované události `data-a` (akce) a `data-in` (inputy), overlaye (bottom sheet / dialog).
- `app/js/db.js` – persistence celého stavu jako jeden záznam v IndexedDB.
- `app/js/pdf.js` – PDF jídelníčku A4 bez knihoven (canvas → JPEG → minimální PDF), sdílení přes Web Share API.
- `app/sw.js` – service worker (network-first). **Při každé změně souborů zvyš `VERSION`** a nový soubor přidej do `ASSETS`.

### Datový model (`state`, schema 2)

- `ingredients[]` {id, name, norm, unit, category}
- `dishes[]` {id, name, tags[snidane|svacina|obed|vecere], taste, contains{fruit,veg}, items[{ingredientId, qty|null, unit|null}], deleted (měkké mazání), version, prepTime, servings, recipe, thermomix, restrictions[]}
- `frozen[]` {id, name, tags[], qty, unit, deleted}
- `plans[]` {id, weekStart 'YYYY-MM-DD' (pondělí), status current|next|archive, slots{"<denIndex>-<jídlo>": [entry]}}
  - entry: `{type:'dish', refId}` | `{type:'frozen', refId, count}` | `{type:'ingredient', refId, qty, unit}`
  - Po–Pá: snídaně, svačina, večeře; So–Ne navíc oběd. Slot může mít víc položek.
- `lists[]` nákupní seznamy {status current|archive, items[{key "ingId|unit", origin plan|manual, state todo|bought|removed, contrib{planId:{qty,missing,dishes}}, carried}], planSigs, coverage, markedDone}
- `migrateState()` převádí starší data (schema 1: 1 entry na slot).

### Klíčová pravidla (viz `domain.js`)

- Kontrola duplicit surovin: normalizace + Levenshtein + společný kmen; `createIngredient` vrací `{reason:'exact'|'similar'}`.
- Mražené: přiřazení odečte `count`, odebrání vrátí; při nedostatku zásob chyba.
- Nákupní seznam: `reconcile()` je diff-based (nakoupené/vyřazené kryjí potřebu, ruční položky se nemažou). Po nákupu (`isPurchaseDone`) se změna jídelníčku řeší dialogem: nový seznam jen se změnami / „Všechno mám“.
- Týdny: `ensureWeeks()` při startu archivuje skončený týden, „další“ se stane aktuálním.

## Testování

- Lokálně: `cd app && python3 -m http.server 8080`.
- Ověřování flow přes Playwright (headless Chromium, viewport 390×844) – vyplnit data přes UI nebo `window.jidelnicek.domain` + `commit()` a udělat screenshoty.
- `window.jidelnicek` = { domain, state, commit, render } pro ladění.

## Další kroky (domluveno)

1. ✅ GitHub + Cloudflare Pages (čeká na první `git push` a propojení v Cloudflare).
2. Cloudflare Worker + D1: synchronizace dat aplikace (telefon/počítač, později 2. uživatel). Free tier stačí.
3. Remote MCP server na Workeru pro Clauda (nástroje: číst knihovnu/historii, přidat pokrm, surovinu, naplánovat slot) se stejnými pravidly jako `domain.js`; přidá se jako vlastní konektor v claude.ai. Doporučený režim: Claude zapisuje **návrh**, který Veronika v aplikaci potvrdí.
4. Instrukce pro Claude projekt (mimo aplikaci): podle jídelníčku školky sladká/slaná snídaně, podle školy ovoce/zelenina ke svačině, hlídat vlákninu, střídat pokrmy; vstupy jsou screenshoty jídelníčků.
