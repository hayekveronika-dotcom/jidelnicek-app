# Jídelníček App – kontext pro Claude Code

Rodinná PWA pro plánování jídelníčku. Uživatelka: Veronika (komunikace česky, stručně, prakticky; nejasnosti se ptát, nedomýšlet).
Zadání: `docs/zadani.md`, návrhy obrazovek: `docs/screens/` (10 obrazovek, mobil 390 px). Uživatelská dokumentace a přijatá rozhodnutí: `app/README.md`.

## Stav (10/2026)

- Hotová PWA ve `app/`: čisté HTML/CSS/JS (ES moduly), bez frameworku a bez build kroku. UI je česky.
- Data lokálně v prohlížeči (IndexedDB přes `app/js/db.js`) + synchronizace přes server (`functions/`, Cloudflare Pages Functions + D1, přístup přes Cloudflare Access). Záloha export/import JSON v menu `⋯`.
- Nasazení: GitHub `hayekveronika-dotcom/jidelnicek-app` → Cloudflare Pages (Build output directory = `app`, žádný build command). Commit do `main` = nasazení.

## Architektura

- `app/js/domain.js` – veškerá pravidla a datový model (čisté funkce nad `state`, bez DOM). Každý zápis musí jít přes tyto funkce – stejná pravidla budou platit pro externí zápis (Claude/MCP).
- `app/js/app.js` – UI: hash router (`#/plan`, `#/library`, `#/dish/:id`, `#/frozen`, `#/shop`, `#/archive`, `#/ingredients`), render přes template stringy, delegované události `data-a` (akce) a `data-in` (inputy), overlaye (bottom sheet / dialog).
- `app/js/db.js` – persistence celého stavu jako jeden záznam v IndexedDB.
- `app/js/sync.js` – synchronizace: `GET/PUT /api/state` s číslem verze (`rev`); při 409 tříbodové sloučení (`base` = poslední stav ze serveru) a nový pokus. `markDirty()` volá `persist()`, `markReplace()` import/smazání (přepíše server). Stav sync se ukládá v IndexedDB pod klíčem `sync`. Při 404 (lokální server) režim `local`.
- `app/js/merge.js` – `mergeStates(base, local, remote)`: po entitách (`id`) a polích, při kolizi vyhrává local, smazání vs. úprava → úprava, `frozen[].qty` jako rozdíly; `normalizeMerged()` spojí zdvojené týdny / aktuální seznamy / položky seznamu. Čisté funkce, použitelné i na serveru (MCP).
- `functions/api/_middleware.js` – ověření JWT Cloudflare Access (env `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`), `context.data.user` = e-mail nebo `common_name` servisního tokenu. `functions/api/state.js` – stav v D1 (binding `DB`): tabulka `app_state` (1 řádek `main`, compare-and-swap přes `rev`), `app_state_history` (posledních 200 verzí). Tabulky se zakládají samy.
- `app/js/proposals.js` – návrhy od Clauda v `state.proposals[]` {id, kind ingredient|dish|plan, data, note, status pending|accepted|rejected, result}. `prepare*()` validuje podle pravidel aplikace (duplicity surovin/pokrmů, jídla podle dne, zásoby mražených), `acceptProposal()` provede přes `domain.js` (názvy se dohledají až při přijetí, takže plan může odkazovat na čekající pokrm). Sdílí aplikace (banner + sheet na Jídelníčku) i server.
- `functions/mcp/[secret].js` – MCP server (Streamable HTTP, bezstavový JSON-RPC, bez SDK). Přístup = `env.MCP_SECRET` v cestě; v Access má `/mcp` pravidlo Bypass. Zapisuje jen návrhy (read → modify → CAS zápis, `updated_by` = `claude`). `server/store.js` – sdílený přístup k D1 (API i MCP).
- `app/js/pdf.js` – PDF jídelníčku A4 bez knihoven (canvas → JPEG → minimální PDF), sdílení přes Web Share API.
- `app/sw.js` – service worker (network-first). **Při každé změně souborů zvyš `VERSION`** a nový soubor přidej do `ASSETS`.

### Datový model (`state`, schema 2)

- `ingredients[]` {id, name, norm, unit, category}
- `dishes[]` {id, name, tags[snidane|svacina|obed|vecere], taste, contains{fruit,veg}, items[{ingredientId, qty|null, unit|null}], deleted (měkké mazání), version, prepTime, servings, recipe, thermomix, restrictions[]}
- `frozen[]` {id, name, tags[], qty, unit, deleted}
- `plans[]` {id (nové týdny `w-YYYY-MM-DD`, kvůli souběžnému založení na 2 zařízeních), weekStart 'YYYY-MM-DD' (pondělí), status current|next|archive, slots{"<denIndex>-<jídlo>": [entry]}}
  - entry: `{type:'dish', refId}` | `{type:'frozen', refId, count}` | `{type:'ingredient', refId, qty, unit}`
  - Po–Pá: snídaně, svačina, večeře; So–Ne navíc oběd. Slot může mít víc položek.
- `lists[]` nákupní seznamy {status current|archive, items[{key "ingId|unit", origin plan|manual, state todo|bought|removed, contrib{planId:{qty,missing,dishes}}, carried, adjust (ruční rozdíl množství proti jídelníčku, `setItemQty`), missingSet}], planSigs, coverage, markedDone}
- `migrateState()` převádí starší data (schema 1: 1 entry na slot) a kategorie: „Ovoce a zelenina“ → Ovoce/Zelenina (seznam ovoce `FRUITS`, vždy), jednorázové přesuny do Sýry/Uzeniny/… pod příznakem `meta.categoryMoves202610`. Pořadí `CATEGORIES` = řazení nákupního seznamu.

### Klíčová pravidla (viz `domain.js`)

- Kontrola duplicit surovin: normalizace + Levenshtein + společný kmen; `createIngredient` vrací `{reason:'exact'|'similar'}`.
- Mražené: přiřazení odečte `count`, odebrání vrátí; při nedostatku zásob chyba.
- Nákupní seznam: `reconcile()` je diff-based (nakoupené/vyřazené kryjí potřebu, ruční položky se nemažou). Po nákupu (`isPurchaseDone`) se změna jídelníčku řeší dialogem: nový seznam jen se změnami / „Všechno mám“.
- Týdny: `ensureWeeks()` při startu archivuje skončený týden, „další“ se stane aktuálním.
- Jednotky: množství (recept, samostatná surovina ve slotu, ruční položka nákupu, návrhy Clauda) vždy v jednotce suroviny – UI jednotku nenabízí, domain/proposals ji vynucují. Staré nesedící položky jen označit (`itemUnitMismatch`, `dishNeedsFix`, filtr „K opravě“), nepřevádět ani nemazat.
- Nákupní seznam: přejetí doleva = stav `removed` (mám doma). Při aktualizaci, když jídelníček potřebuje smazanou položku (`removedForPlan`), dialog „Obnovit smazané položky?“ → `syncPlanToList(..., {restore})`; nakoupené zůstávají.

## Testování

- Lokálně: `cd app && python3 -m http.server 8080`.
- Ověřování flow přes Playwright (headless Chromium, viewport 390×844) – vyplnit data přes UI nebo `window.jidelnicek.domain` + `commit()` a udělat screenshoty.
- `window.jidelnicek` = { domain, state, commit, render } pro ladění.
- Synchronizace lokálně: wrangler/Node na Macu nejsou. Testovací server v Pythonu se stejným SQL jako `state.js` (sqlite) + 2 „zařízení“ = `localhost:8787` a `127.0.0.1:8787` (oddělené IndexedDB). V skrytém panelu prohlížeče nechodí `visibilitychange`, sync spouštět přes `[data-a=syncNow]`.
- MCP lokálně: statický server z kořene repa a v prohlížeči `import('/functions/mcp/%5Bsecret%5D.js')` + falešné D1 (jen dotazy ze `server/store.js`), volat `onRequest({request, env, params})`. Na produkci: `curl -X POST https://jidelnicek-app.pages.dev/mcp/<secret>` s JSON-RPC `tools/list`.

## Další kroky (domluveno)

1. ✅ GitHub + Cloudflare Pages (push hotový; propojení v Cloudflare dělá Veronika).
2. ✅ Synchronizace: Pages Functions + D1 + Cloudflare Access, slučování po entitách. Nastavení v dashboardu podle `app/README.md` (D1 binding `DB`, Access aplikace, env proměnné) dělá Veronika.
3. ✅ MCP konektor pro Clauda: tajná adresa (Veronika zvolila místo OAuth), Claude jen navrhuje, Veronika potvrzuje v aplikaci. Plán claude.ai: Pro. Nastavení (MCP_SECRET, Access Bypass pro `/mcp`, konektor) podle `app/README.md`.
4. Instrukce pro Claude projekt (mimo aplikaci): podle jídelníčku školky sladká/slaná snídaně, podle školy ovoce/zelenina ke svačině, hlídat vlákninu, střídat pokrmy; vstupy jsou screenshoty jídelníčků.
