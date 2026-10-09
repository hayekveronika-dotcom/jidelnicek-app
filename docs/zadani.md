# Jídelníček App – zadání

Oct 4, 2026 · @Veronika

## Přehled

Nová samostatná aplikace pro plánování rodinného jídelníčku, navázaná na nákupní seznam a evidenci mražených zásob.

- **Platforma:** PWA (webová aplikace instalovatelná na telefon).
- **Uživatelé:** zatím 1 uživatel, v budoucnu možná 2. Data mají být uložená tak, aby šlo sdílení přidat bez přestavby.
- **Moduly:** Databáze surovin, Knihovna pokrmů, Jídelníček, Mražené zásoby, Nákupní seznam. Agent v aplikaci nebude, později může zapisovat externí Claude projekt.

## Databáze surovin

Společný číselník surovin, ze kterého čerpají všechny moduly. Zajišťuje jednotné pojmenování, bez něj nejde správně sčítat nákupní seznam.

- **Atributy suroviny:** název, výchozí jednotka (g, ml, ks, lžíce…), kategorie pro řazení v nákupu (zelenina, mléčné výrobky…).
- **Nová surovina** jde založit přímo při vyplňování pokrmu nebo nákupního seznamu, ale vždy projde kontrolou duplicit.
- **Kontrola duplicit:**
  - normalizace před porovnáním: malá písmena, bez diakritiky, ořezané mezery (Avokádo = avokádo),
  - nabídka podobných názvů při psaní („Nemyslíš *passata*?“), konkrétní algoritmus podobnosti určí vývoj,
  - funkce **Sloučit suroviny**: vybraná duplicita se nahradí hlavní surovinou ve všech pokrmech, zásobách i seznamech.
- **Sjednocování jednotek:** pokud stejná surovina přijde v různých jednotkách (g a ks), na seznamu se zobrazí odděleně. Převody jednotek zatím nejsou součástí zadání.

## Knihovna pokrmů

Katalog pokrmů, ze kterého se plní jídelníček. Pokrm musí mít seznam surovin, množství je volitelné.

- **Štítky (filtry):** snídaně, svačina, oběd, večeře. Pokrm může mít více štítků.
- **Povinné údaje:** název, aspoň 1 štítek, aspoň 1 surovina.
- **Suroviny pokrmu:** výběr z databáze surovin s našeptávačem, množství a jednotka volitelně.
- **Chuť a složení (nepovinné):** chuť sladké / slané (jedna volba), obsahuje ovoce / zeleninu (lze obojí). Slouží k filtrování a budoucímu externímu zápisu.
- **Volitelné údaje (k potvrzení):** čas přípravy, počet porcí, postup nebo odkaz na recept, příznak Thermomix, fotka, štítky omezení (např. bez mléka). Vláknina se zatím neeviduje.
- **Seznam pokrmů:** filtr podle štítků + textové vyhledávání.
- **Úprava a smazání:** nemění už naplánovaný jídelníček. Smazaný pokrm zůstává v jídelníčku graficky odlišený. Dopady na nákupní seznam popisuje kapitola Nákupní seznam.

## Jídelníček

Týdenní plán jídel. Současně existují nejvýš 2 jídelníčky: **aktuální** a **další**.

| Dny | Sloty |
| --- | --- |
| Pondělí–pátek | snídaně, svačina, večeře (obědy se neřeší) |
| Sobota–neděle | snídaně, svačina, oběd, večeře |

- **Přiřazení pokrmu:** tlačítko u slotu otevře výběr z knihovny, předfiltrovaný podle kategorie slotu, s textovým vyhledáváním. Filtr jde zrušit.
- **Přiřazení mraženého pokrmu:** ručně, ze stejného výběru (záložka Mražené) nebo z modulu Mražené zásoby.
- **Smazaný pokrm** zůstává ve slotu, graficky odlišený.
- **Tlačítko \[Přidat suroviny na nákupní seznam\]**, po změně jídelníčku nebo receptury se změní na **\[Aktualizovat nákupní seznam\]**.
- **Archiv:** po skončení týdne se aktuální jídelníček archivuje, „další“ se stane aktuálním. Historie pomáhá hlídat obměnu pokrmů.
- **Plnění: ručně, případně později externím zápisem (viz kapitola Agent a externí zápis**).

## Mražené zásoby

Funguje jako knihovna, navíc eviduje počet kusů nebo porcí. Do jídelníčku se přiřazuje ručně.

- **Atributy:** název, štítky, množství + jednotka (ks, porce, sáček).
- **Pohyb zásob:** přiřazení do jídelníčku = −1, odebrání z jídelníčku = +1 (perník 6 ks → po přiřazení 5 ks).
- **Doplnění:** ruční úprava množství (např. po uvaření a zamražení).
- **Nákupní seznam:** mražené pokrmy do něj nepřidávají žádné suroviny.
- **Stav 0 ks:** pokrm se v nabídce zobrazí jako vyprodaný a nejde přiřadit (k potvrzení).

## Nákupní seznam

Vždy existuje právě 1 aktuální nákupní seznam, starší verze jsou v archivu. Do aktuálního se propisují suroviny z jakéhokoli jídelníčku.

### Zdroje položek

- **Jídelníček:** přes tlačítko \[Přidat suroviny na nákupní seznam\] / \[Aktualizovat nákupní seznam\].
- **Ručně:** libovolná surovina z databáze surovin, mimo jídelníček.
- **Převedené:** nenakoupené položky z předchozího seznamu po archivaci.

Každá položka nese svůj původ a vazbu na pokrmy, ze kterých vznikla.

### Stavy položky

| Stav | Jak vznikne | Chování při aktualizaci |
| --- | --- | --- |
| K nákupu | přidání z jídelníčku nebo ručně | množství se přepočítá, příp. položka zmizí |
| Nakoupeno | odškrtnutí nebo tlačítko \[Nakoupeno\] | neovlivňuje se |
| Vyřazeno (mám doma) | smazání položky ze seznamu | znovu se nepřidá |

### Pravidla

- **Slučování:** stejná surovina z více pokrmů = 1 řádek, množství se sečtou. Kde chybí množství, zobrazí se „200 g + další“.
- **Aktualizace** položky z jídelníčku přidává i odebírá. Spouští ji změna jídelníčku i změna receptury naplánovaného pokrmu.
- **Ruční položky** aktualizace nikdy nemaže.
- **Smazaný pokrm** se počítá podle poslední verze receptu.
- **Po nákupu:** změna už neovlivní nakoupené položky. Zobrazí se upozornění „Nákup již proběhl, zkontrolujte stav zásob“ s tlačítkem \[Vytvořit nový nákupní seznam\].

### Tlačítka

- **\[Nakoupeno\]:** hromadně označí všechny položky jako nakoupené.
- **\[Archivovat\]:** uzavře a archivuje seznam, neoznačené položky převede do nového aktuálního seznamu.
- **\[+ Přidat surovinu\]:** ruční přidání z databáze.

## Agent a externí zápis

Agent v aplikaci nebude, jídelníček se plní ručně. Později může jídelníček navrhovat a zapisovat do aplikace externí Claude projekt.

- **Rozhraní pro zápis zvenčí:** aplikace by měla umět přijímat zápisy z jiného nástroje (např. API nebo MCP server). Konkrétní řešení určí vývoj, včetně ověření, co jde s Claude napojit.
- **Stejná pravidla jako ruční zadání:** suroviny jen z databáze s kontrolou duplicit, pohyb mražených zásob ±1, nabídka aktualizace nákupního seznamu.
- **Instrukce pro budoucí Claude projekt** (mimo aplikaci):
  - podle jídelníčku školky: když je dopolední svačina nebo oběd sladký, dát slanou snídani,
  - podle jídelníčku školy: když je k obědu ovoce, dát ke svačině zeleninu, a naopak,
  - hlídat množství vlákniny, nesmí jí být moc,
  - sledovat historii a pravidelně střídat pokrmy.
- **Vstupy:** jídelníčky školky a školy jako screenshot, takže Claude projekt musí umět číst obrázky.

## Datový model

Zjednodušený přehled entit jako podklad pro vývoj. Přesné názvy polí a typy určí vývojář.

| Entita | Hlavní údaje | Vazby |
| --- | --- | --- |
| Surovina | název, normalizovaný název, jednotka, kategorie | používá ji Pokrm, Položka seznamu |
| Pokrm | název, štítky, chuť, ovoce/zelenina, smazáno ano/ne, verze receptu | má Suroviny pokrmu |
| Surovina pokrmu | množství (volitelné), jednotka | Pokrm ↔ Surovina |
| Mražený pokrm | název, štítky, množství, jednotka | přiřazuje se do Slotu |
| Jídelníček | týden, stav (aktuální / další / archiv) | má Sloty |
| Slot | den, typ jídla | odkaz na Pokrm nebo Mražený pokrm |
| Nákupní seznam | stav (aktuální / archiv), datum | má Položky |
| Položka seznamu | surovina, množství, původ, stav | odkaz na Sloty, ze kterých vznikla |
| Externí přístup (později) | oprávnění k zápisu (k upřesnění) | čte a zapisuje Jídelníček, Knihovnu, Nákupní seznam |

Smazání pokrmu je „měkké“ (označení jako smazaný), aby jídelníček i nákupní seznam mohly použít poslední verzi receptu.

## Obrazovky pro Figmu

Návrh 10 obrazovek pro mobilní PWA, navigace spodní lištou (Jídelníček, Knihovna, Mražené, Nákup).

1. **Jídelníček:** přepínač aktuální / další, dny se sloty, tlačítko \[Přidat / Aktualizovat nákupní seznam\].
2. **Výběr pokrmu do slotu:** bottom sheet, předfiltrováno podle kategorie, vyhledávání, záložky Knihovna / Mražené.
3. **Knihovna:** seznam pokrmů, filtr štítků, vyhledávání, \[+ Přidat pokrm\].
4. **Detail / editace pokrmu:** název, štítky, suroviny s našeptávačem a množstvím.
5. **Přidání suroviny + kontrola duplicit:** dialog „Nemyslíš …?“
6. **Mražené zásoby:** seznam s počty, rychlé +/−.
7. **Nákupní seznam:** položky podle kategorií, odškrtávání, \[Nakoupeno\], \[Archivovat\], \[+ Přidat surovinu\].
8. **Upozornění „Nákup již proběhl“:** dialog s \[Vytvořit nový nákupní seznam\].
9. **Archiv:** jídelníčky a nákupní seznamy.
10. **Správa surovin:** seznam surovin, \[Sloučit duplicity\]. Obrazovka pro agenta v aplikaci nebude.

## Otevřené otázky

- [ ] Kdy platí „nákup již proběhl“: po \[Nakoupeno\], po odškrtnutí všech položek, nebo po \[Archivovat\]? A liší se \[Vytvořit nový nákupní seznam\] od \[Archivovat\]?
- [ ] Aktualizace: když je položka už odškrtnutá a její pokrm se z jídelníčku odebere, zůstane na seznamu?
- [ ] Archivace jídelníčku: automaticky po skončení týdne, nebo ručně?
- [ ] Může být v jednom slotu víc pokrmů (hlavní + příloha)?
- [ ] Zbytky: jeden pokrm ve 2 slotech, suroviny jen jednou?
- [ ] Které volitelné atributy pokrmu chceme (čas přípravy, porce, postup, Thermomix, fotka, omezení)?
- [ ] Převody jednotek (ks ↔ g) řešit, nebo ne?
- [ ] Řadit nákupní seznam podle kategorií surovin, nebo podle obchodů?
- [ ] Je mražený pokrm propojený s pokrmem v knihovně? A blokovat přiřazení při stavu 0 ks?
- [ ] Jde výběr pokrmu ve slotu přepnout mimo předfiltrovanou kategorii?
