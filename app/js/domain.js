// Doménová logika Jídelníček App – čistá data, žádné DOM.
// Všechny zápisy jdou přes funkce v tomto souboru, aby je později mohl
// použít i externí zápis (API / MCP) se stejnými pravidly.

export const TAGS = [
  { key: 'snidane', label: 'Snídaně' },
  { key: 'svacina', label: 'Svačina' },
  { key: 'obed', label: 'Oběd' },
  { key: 'vecere', label: 'Večeře' },
];
export const TAG_LABEL = Object.fromEntries(TAGS.map(t => [t.key, t.label]));

export const WEEKDAY_SLOTS = ['snidane', 'svacina', 'vecere'];
export const WEEKEND_SLOTS = ['snidane', 'svacina', 'obed', 'vecere'];
export const DAY_NAMES = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];

export const UNITS = ['g', 'kg', 'ml', 'l', 'ks', 'lžíce', 'lžička', 'hrnek', 'balení', 'plátek', 'stroužek', 'špetka'];
export const FROZEN_UNITS = ['ks', 'porce', 'sáček'];
export const CATEGORIES = [
  'Ovoce a zelenina', 'Pečivo', 'Mléčné výrobky a vejce', 'Maso a ryby',
  'Trvanlivé', 'Koření a dochucovadla', 'Mražené', 'Nápoje', 'Ostatní',
];

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export function emptyState() {
  return {
    schema: 1,
    ingredients: [],
    dishes: [],
    frozen: [],
    plans: [],
    lists: [],
    proposals: [], // návrhy od Clauda (proposals.js)
    meta: { createdAt: new Date().toISOString() },
  };
}

// ---------- Datumy ----------
const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export function addDays(s, n) { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const wd = (d.getDay() + 6) % 7; // 0 = pondělí
  d.setDate(d.getDate() - wd);
  return iso(d);
}
export function fmtDay(s) { const d = parseIso(s); return `${d.getDate()}. ${d.getMonth() + 1}.`; }
export function fmtWeek(weekStart) {
  const a = parseIso(weekStart), b = parseIso(addDays(weekStart, 6));
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}.–${b.getDate()}. ${b.getMonth() + 1}.`;
  return `${a.getDate()}. ${a.getMonth() + 1}.–${b.getDate()}. ${b.getMonth() + 1}.`;
}
export const slotsForDay = di => (di >= 5 ? WEEKEND_SLOTS : WEEKDAY_SLOTS);

// ---------- Normalizace a podobnost ----------
export function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
// Jsou si dva normalizované názvy podobné? (překlep, jednotné/množné číslo…)
export function isSimilar(na, nb) {
  if (!na || !nb) return false;
  if (na === nb) return true;
  const len = Math.min(na.length, nb.length);
  const max = len <= 4 ? 1 : len <= 8 ? 2 : 3;
  if (levenshtein(na, nb) <= max) return true;
  // společný kmen (např. "rajce" vs "rajcata")
  if (len >= 4) {
    const stem = Math.max(4, len - 2);
    if (na.slice(0, stem) === nb.slice(0, stem)) return true;
  }
  return false;
}
export function findSimilarIngredients(state, name, excludeId = null) {
  const n = normalize(name);
  if (!n) return [];
  return state.ingredients.filter(i => i.id !== excludeId && isSimilar(n, i.norm));
}
export function findExactIngredient(state, name) {
  const n = normalize(name);
  return state.ingredients.find(i => i.norm === n) || null;
}
export function searchIngredients(state, q) {
  const n = normalize(q);
  if (!n) return [...state.ingredients].sort(byName);
  return state.ingredients
    .filter(i => i.norm.includes(n))
    .sort((a, b) => (a.norm.startsWith(n) ? 0 : 1) - (b.norm.startsWith(n) ? 0 : 1) || byName(a, b));
}
export const byName = (a, b) => a.name.localeCompare(b.name, 'cs');

// ---------- Suroviny ----------
export const getIngredient = (s, id) => s.ingredients.find(i => i.id === id);

// Vrací {ok, ingredient} nebo {ok:false, reason:'exact'|'similar', matches}
export function createIngredient(state, { name, unit, category }, { force = false } = {}) {
  name = (name || '').trim();
  if (!name) throw new Error('Název suroviny je povinný.');
  const exact = findExactIngredient(state, name);
  if (exact) return { ok: false, reason: 'exact', matches: [exact] };
  if (!force) {
    const sim = findSimilarIngredients(state, name);
    if (sim.length) return { ok: false, reason: 'similar', matches: sim };
  }
  const ing = { id: uid(), name, norm: normalize(name), unit: unit || 'ks', category: category || 'Ostatní' };
  state.ingredients.push(ing);
  return { ok: true, ingredient: ing };
}
export function updateIngredient(state, id, { name, unit, category }) {
  const ing = getIngredient(state, id);
  if (!ing) return { ok: false };
  if (name != null) {
    name = name.trim();
    if (!name) throw new Error('Název suroviny je povinný.');
    const n = normalize(name);
    const clash = state.ingredients.find(i => i.id !== id && i.norm === n);
    if (clash) return { ok: false, reason: 'exact', matches: [clash] };
    ing.name = name; ing.norm = n;
  }
  if (unit) ing.unit = unit;
  if (category) ing.category = category;
  return { ok: true, ingredient: ing };
}
export function ingredientUsage(state, id) {
  const dishes = state.dishes.filter(d => !d.deleted && d.items.some(it => it.ingredientId === id));
  const inLists = state.lists.some(l => l.status === 'current' && l.items.some(it => it.ingredientId === id));
  return { dishes, dishCount: dishes.length, inLists };
}
export function deleteIngredient(state, id) {
  const anyUse = state.dishes.some(d => d.items.some(it => it.ingredientId === id)) ||
    state.plans.some(p => allEntries(p).some(e => e.type === 'ingredient' && e.refId === id)) ||
    state.lists.some(l => l.items.some(it => it.ingredientId === id));
  if (anyUse) throw new Error('Surovina se používá v pokrmech nebo seznamech. Použijte Sloučit.');
  state.ingredients = state.ingredients.filter(i => i.id !== id);
}
// Dvojice možných duplicit pro obrazovku Správa surovin
export function duplicatePairs(state) {
  const out = [];
  const ings = state.ingredients;
  const dismissed = new Set(state.meta.dismissedDuplicates || []);
  for (let i = 0; i < ings.length; i++) {
    for (let j = i + 1; j < ings.length; j++) {
      const a = ings[i], b = ings[j];
      const k = [a.id, b.id].sort().join('|');
      if (dismissed.has(k)) continue;
      if (isSimilar(a.norm, b.norm)) out.push([a, b]);
    }
  }
  return out;
}
export function dismissDuplicate(state, aId, bId) {
  state.meta.dismissedDuplicates = state.meta.dismissedDuplicates || [];
  state.meta.dismissedDuplicates.push([aId, bId].sort().join('|'));
}

// Sloučí surovinu dupId do mainId ve všech pokrmech, seznamech i krytí.
export function mergeIngredients(state, mainId, dupId) {
  if (mainId === dupId) return;
  const main = getIngredient(state, mainId), dup = getIngredient(state, dupId);
  if (!main || !dup) return;
  // které jídelníčky byly synchronní se seznamem – po sloučení je znovu podepíšeme
  const list = currentList(state);
  const inSync = livePlans(state).filter(p => list.planSigs[p.id] !== undefined && list.planSigs[p.id] === planSig(state, p));

  for (const p of state.plans) for (const e of allEntries(p)) if (e.type === 'ingredient' && e.refId === dupId) e.refId = mainId;
  for (const d of state.dishes) {
    const merged = [];
    for (const it of d.items) {
      const x = { ...it, ingredientId: it.ingredientId === dupId ? mainId : it.ingredientId };
      const same = merged.find(m => m.ingredientId === x.ingredientId && (m.unit || '') === (x.unit || ''));
      if (same && x.ingredientId === mainId) {
        if (x.qty != null) same.qty = (same.qty || 0) + x.qty;
      } else merged.push(x);
    }
    if (d.items.some(it => it.ingredientId === dupId)) d.version = (d.version || 1) + 1;
    d.items = merged;
  }
  const remapKey = k => { const [ing, unit] = k.split('|'); return (ing === dupId ? mainId : ing) + '|' + unit; };
  for (const l of state.lists) {
    for (const it of l.items) {
      if (it.ingredientId === dupId) { it.ingredientId = mainId; it.key = remapKey(it.key); }
    }
    // sloučit řádky se stejným klíčem, stavem a původem
    const merged = [];
    for (const it of l.items) {
      const same = merged.find(m => m.key === it.key && m.state === it.state && (m.origin === 'manual') === (it.origin === 'manual'));
      if (same) {
        if (it.origin === 'manual') same.qty = (same.qty || 0) + (it.qty || 0);
        else for (const [pid, c] of Object.entries(it.contrib || {})) {
          const s = same.contrib[pid];
          same.contrib[pid] = s ? { qty: s.qty + c.qty, missing: s.missing + c.missing, dishes: [...new Set([...s.dishes, ...c.dishes])] } : c;
        }
      } else merged.push(it);
    }
    l.items = merged;
    for (const pid of Object.keys(l.coverage || {})) {
      const cov = {};
      for (const [k, v] of Object.entries(l.coverage[pid])) {
        const nk = remapKey(k);
        cov[nk] = cov[nk] ? { qty: cov[nk].qty + v.qty, missing: cov[nk].missing || v.missing } : v;
      }
      l.coverage[pid] = cov;
    }
  }
  state.ingredients = state.ingredients.filter(i => i.id !== dupId);
  for (const p of inSync) list.planSigs[p.id] = planSig(state, p);
}

// ---------- Pokrmy ----------
export const getDish = (s, id) => s.dishes.find(d => d.id === id);
export function validateDish(d) {
  const errs = [];
  if (!d.name || !d.name.trim()) errs.push('Vyplňte název.');
  if (!d.tags || !d.tags.length) errs.push('Vyberte aspoň 1 štítek.');
  if (!d.items || !d.items.length) errs.push('Přidejte aspoň 1 surovinu.');
  return errs;
}
export function saveDish(state, draft) {
  const errs = validateDish(draft);
  if (errs.length) throw new Error(errs.join(' '));
  const clean = {
    name: draft.name.trim(),
    tags: [...draft.tags],
    taste: draft.taste || null,
    contains: { fruit: !!draft.contains?.fruit, veg: !!draft.contains?.veg },
    items: draft.items.map(it => ({ ingredientId: it.ingredientId, qty: it.qty == null || it.qty === '' ? null : Number(it.qty), unit: it.unit || null })),
    prepTime: draft.prepTime ? Number(draft.prepTime) : null,
    servings: draft.servings ? Number(draft.servings) : null,
    recipe: (draft.recipe || '').trim(),
    thermomix: !!draft.thermomix,
    restrictions: (draft.restrictions || []).filter(Boolean),
  };
  if (draft.id) {
    const d = getDish(state, draft.id);
    const recipeChanged = JSON.stringify(d.items) !== JSON.stringify(clean.items);
    Object.assign(d, clean);
    if (recipeChanged) d.version = (d.version || 1) + 1;
    d.updatedAt = new Date().toISOString();
    return d;
  }
  const d = { id: uid(), ...clean, deleted: false, version: 1, createdAt: new Date().toISOString() };
  state.dishes.push(d);
  return d;
}
// Množství v receptu musí být v jednotce suroviny (jinak by na nákupním seznamu byla jedna surovina dvakrát).
// Starší recepty s jinou jednotkou se jen označí k opravě – převody jednotek aplikace neumí.
export const itemUnitMismatch = (state, it) => {
  const ing = getIngredient(state, it.ingredientId);
  return !!(ing && it.qty != null && it.unit && it.unit !== ing.unit);
};
export const dishNeedsFix = (state, d) => d.items.some(it => itemUnitMismatch(state, it));

// Měkké smazání – naplánované sloty i nákupní seznam dál používají poslední verzi receptu.
export function deleteDish(state, id) { const d = getDish(state, id); if (d) { d.deleted = true; d.deletedAt = new Date().toISOString(); } }
export function restoreDish(state, id) { const d = getDish(state, id); if (d) d.deleted = false; }

// Kdy byl pokrm naposledy v jídelníčku (pro hlídání obměny)
export function lastUsed(state, dishId, excludePlanId = null) {
  let best = null;
  for (const p of state.plans) {
    if (p.id === excludePlanId) continue;
    if (allEntries(p).some(s => s.type === 'dish' && s.refId === dishId)) {
      if (!best || p.weekStart > best) best = p.weekStart;
    }
  }
  return best;
}

// ---------- Mražené ----------
export const getFrozen = (s, id) => s.frozen.find(f => f.id === id);
export function saveFrozen(state, draft) {
  if (!draft.name || !draft.name.trim()) throw new Error('Vyplňte název.');
  const clean = { name: draft.name.trim(), tags: [...(draft.tags || [])], qty: Math.max(0, Number(draft.qty) || 0), unit: draft.unit || 'ks' };
  if (draft.id) { const f = getFrozen(state, draft.id); Object.assign(f, clean); return f; }
  const f = { id: uid(), ...clean, deleted: false };
  state.frozen.push(f);
  return f;
}
export function adjustFrozen(state, id, delta) {
  const f = getFrozen(state, id);
  if (f) f.qty = Math.max(0, (f.qty || 0) + delta);
}
export function deleteFrozen(state, id) { const f = getFrozen(state, id); if (f) f.deleted = true; }

// ---------- Jídelníčky ----------
export const livePlans = s => s.plans.filter(p => p.status === 'current' || p.status === 'next');
export const getPlan = (s, id) => s.plans.find(p => p.id === id);
// ID podle týdne: když týden založí dvě zařízení současně, synchronizace je spojí do jednoho
const newPlan = (weekStart, status) => ({ id: `w-${weekStart}`, weekStart, status, slots: {} });
const planIsEmpty = p => allEntries(p).length === 0;

// Slot obsahuje pole pokrmů: p.slots[key] = [{ type: 'dish'|'frozen', refId }, ...]
export const slotItems = (p, key) => (p.slots[key] || []);
export const allEntries = p => Object.values(p.slots).flat();
// Převod starších dat (1 pokrm na slot) na pole
export function migrateState(state) {
  for (const p of state.plans) {
    for (const [k, v] of Object.entries(p.slots || {})) {
      if (!Array.isArray(v)) p.slots[k] = v ? [v] : [];
      if (!p.slots[k].length) delete p.slots[k];
    }
  }
  state.proposals = state.proposals || [];
  state.schema = 2;
  return state;
}

function archivePlan(state, p) {
  if (planIsEmpty(p)) { state.plans = state.plans.filter(x => x !== p); return; }
  p.status = 'archive';
  p.archivedAt = new Date().toISOString();
}
// Posune týdny: skončený aktuální → archiv, další → aktuální, založí nový další.
export function ensureWeeks(state, today = new Date()) {
  const mon = mondayOf(today);
  let cur = state.plans.find(p => p.status === 'current');
  let next = state.plans.find(p => p.status === 'next');
  if (!cur) {
    if (next && next.weekStart <= mon) { next.status = 'current'; cur = next; next = null; }
    else { cur = newPlan(mon, 'current'); state.plans.push(cur); }
  }
  let changed = false;
  while (cur.weekStart < mon) {
    archivePlan(state, cur);
    if (next) { next.status = 'current'; cur = next; next = null; }
    else { cur = newPlan(addDays(cur.weekStart, 7), 'current'); state.plans.push(cur); }
    changed = true;
  }
  if (!next) { next = newPlan(addDays(cur.weekStart, 7), 'next'); state.plans.push(next); }
  return changed;
}
// Ruční uzavření týdne (tlačítko v nastavení)
export function archiveWeekManually(state) {
  const cur = state.plans.find(p => p.status === 'current');
  let next = state.plans.find(p => p.status === 'next');
  archivePlan(state, cur);
  if (!next) { next = newPlan(addDays(cur.weekStart, 7), 'next'); state.plans.push(next); }
  next.status = 'current';
  state.plans.push(newPlan(addDays(next.weekStart, 7), 'next'));
}
export const slotKey = (dayIndex, meal) => `${dayIndex}-${meal}`;

// Přidání pokrmu / mraženého pokrmu do slotu (slot může mít víc pokrmů).
// replaceIndex: nahradí konkrétní pokrm ve slotu. Vrací {ok, error}
export function assignSlot(state, planId, key, ref, { replaceIndex = null } = {}) {
  const p = getPlan(state, planId);
  if (!p) return { ok: false, error: 'Jídelníček nenalezen.' };
  const items = p.slots[key] || [];
  if (replaceIndex != null) {
    const cur = items[replaceIndex];
    if (cur && cur.type === ref.type && cur.refId === ref.refId) return { ok: true };
  }
  if (ref.type === 'frozen') {
    const f = getFrozen(state, ref.refId);
    if (!f || f.deleted) return { ok: false, error: 'Mražený pokrm neexistuje.' };
    const need = Math.max(1, Math.round(ref.count || 1));
    if (f.qty < need) return { ok: false, error: f.qty <= 0 ? `${f.name}: došlo, nelze přiřadit.` : `${f.name}: v mrazáku je jen ${f.qty} ${f.unit}.` };
  }
  if (ref.type === 'ingredient' && !getIngredient(state, ref.refId)) return { ok: false, error: 'Surovina neexistuje.' };
  const entry = { type: ref.type, refId: ref.refId };
  if (ref.type === 'frozen') entry.count = Math.max(1, Math.round(ref.count || 1));
  if (ref.type === 'ingredient') { entry.qty = ref.qty ?? null; entry.unit = entry.qty == null ? null : getIngredient(state, ref.refId).unit; }
  if (replaceIndex != null && items[replaceIndex]) {
    returnFrozen(state, p, items[replaceIndex]);
    items[replaceIndex] = entry;
  } else {
    items.push(entry);
  }
  p.slots[key] = items;
  if (ref.type === 'frozen') adjustFrozen(state, ref.refId, -entry.count);
  return { ok: true };
}
function returnFrozen(state, p, entry) {
  if (entry.type === 'frozen' && p.status !== 'archive') {
    const f = getFrozen(state, entry.refId);
    if (f && !f.deleted) adjustFrozen(state, f.id, +(entry.count || 1));
  }
}
// Počet kusů/porcí mraženého pokrmu ve slotu; rozdíl se odečte / vrátí do mrazáku
export function setFrozenCount(state, planId, key, index, count) {
  const p = getPlan(state, planId);
  const e = p && p.slots[key] && p.slots[key][index];
  if (!e || e.type !== 'frozen') return { ok: false };
  const f = getFrozen(state, e.refId);
  const n = Math.max(1, Math.round(Number(count) || 1));
  const delta = n - (e.count || 1);
  if (delta > 0 && f && f.qty < delta) return { ok: false, error: `${f.name}: v mrazáku zbývá jen ${f.qty} ${f.unit}.` };
  if (f && !f.deleted && p.status !== 'archive') adjustFrozen(state, f.id, -delta);
  e.count = n;
  return { ok: true };
}
// Odebere jeden pokrm ze slotu (mražený vrátí +1 do mrazáku)
export function removeFromSlot(state, planId, key, index) {
  const p = getPlan(state, planId);
  const items = p && p.slots[key];
  if (!items || !items[index]) return;
  returnFrozen(state, p, items[index]);
  items.splice(index, 1);
  if (!items.length) delete p.slots[key];
}
// Množství u samostatné suroviny ve slotu (nepovinné)
// Množství je vždy v jednotce suroviny.
export function setSlotEntryQty(state, planId, key, index, qty) {
  const p = getPlan(state, planId);
  const e = p && p.slots[key] && p.slots[key][index];
  if (!e || e.type !== 'ingredient') return;
  e.qty = qty == null || qty === '' ? null : Number(qty);
  e.unit = e.qty == null ? null : (getIngredient(state, e.refId)?.unit || null);
}
export function clearSlot(state, planId, key) {
  const p = getPlan(state, planId);
  const items = p && p.slots[key];
  if (!items) return;
  items.forEach(e => returnFrozen(state, p, e));
  delete p.slots[key];
}
export function planStats(state, p) {
  const vals = allEntries(p);
  return { dishes: vals.filter(v => v.type === 'dish').length, frozen: vals.filter(v => v.type === 'frozen').reduce((n, v) => n + (v.count || 1), 0), ingredients: vals.filter(v => v.type === 'ingredient').length };
}

// ---------- Nákupní seznam ----------
export function currentList(state) {
  let l = state.lists.find(x => x.status === 'current');
  if (!l) {
    l = { id: uid(), status: 'current', createdAt: new Date().toISOString(), items: [], planSigs: {}, coverage: {}, markedDone: false };
    state.lists.push(l);
  }
  return l;
}
const r3 = n => Math.round(n * 1000) / 1000;

// Potřeba surovin jednoho jídelníčku: key "ingId|unit" → {qty, missing, dishes}
export function planDemand(state, plan) {
  const out = {};
  for (const slot of allEntries(plan)) {
    let dish;
    if (slot.type === 'ingredient') {
      // samostatná surovina v jídelníčku se chová jako "pokrm" s jednou surovinou
      dish = { name: 'samostatně v jídelníčku', items: [{ ingredientId: slot.refId, qty: slot.qty, unit: slot.unit }] };
    } else if (slot.type === 'dish') {
      dish = getDish(state, slot.refId);
    } // mražené nic nepřidávají
    if (!dish) continue;
    for (const it of dish.items) {
      const ing = getIngredient(state, it.ingredientId);
      if (!ing) continue;
      const hasQty = it.qty != null && it.qty > 0;
      const unit = (hasQty && it.unit) || ing.unit;
      const key = `${ing.id}|${unit}`;
      const e = out[key] || (out[key] = { ingredientId: ing.id, unit, qty: 0, missing: 0, dishes: [] });
      if (hasQty) e.qty = r3(e.qty + it.qty); else e.missing++;
      if (!e.dishes.includes(dish.name)) e.dishes.push(dish.name);
    }
  }
  return out;
}
export function planSig(state, plan) {
  const d = planDemand(state, plan);
  return JSON.stringify(Object.keys(d).sort().map(k => [k, d[k].qty, d[k].missing]));
}
// 'add' | 'update' | 'synced' | 'empty'
export function planListStatus(state, plan) {
  const list = currentList(state);
  const has = allEntries(plan).some(s => s.type === 'dish' || s.type === 'ingredient');
  const sig = list.planSigs[plan.id];
  if (sig === undefined) return has ? 'add' : 'empty';
  return sig === planSig(state, plan) ? 'synced' : 'update';
}
export function isPurchaseDone(list) {
  const active = list.items.filter(i => i.state !== 'removed');
  return !!list.markedDone || (active.length > 0 && active.every(i => i.state === 'bought'));
}
const newListItem = (ingredientId, unit, origin) =>
  ({ id: uid(), ingredientId, unit, key: `${ingredientId}|${unit}`, origin, state: 'todo', contrib: {}, qty: null });

// Vyřazené položky („mám doma“), které by jídelníček zase potřeboval – na ty se při aktualizaci ptáme.
export function removedForPlan(state, planId) {
  const plan = getPlan(state, planId);
  const demand = planDemand(state, plan);
  return currentList(state).items.filter(i => i.origin !== 'manual' && i.state === 'removed' && demand[i.key]);
}

// Srovná seznam s potřebou jídelníčku. mode 'absorb' = vše nové bereme jako "mám doma".
// restore = vyřazené položky, které jídelníček potřebuje, se vrátí mezi nenakoupené.
export function reconcile(state, list, plan, mode = 'normal', { restore = false } = {}) {
  const P = plan.id;
  const demand = planDemand(state, plan);
  const cov = (list.coverage[P] = list.coverage[P] || {});
  const keys = new Set([...Object.keys(demand), ...Object.keys(cov)]);
  for (const it of list.items) if (it.contrib && it.contrib[P]) keys.add(it.key);

  for (const key of keys) {
    const need = demand[key];
    const forKey = list.items.filter(i => i.key === key && i.origin !== 'manual');
    const bought = forKey.filter(i => i.state === 'bought');
    let todo = forKey.find(i => i.state === 'todo');
    const removed = forKey.find(i => i.state === 'removed');
    const drop = it => { if (it && it.contrib) delete it.contrib[P]; };

    if (!need) { drop(todo); drop(removed); continue; }
    const boughtQty = (cov[key]?.qty || 0) + bought.reduce((s, i) => s + (i.contrib[P]?.qty || 0), 0);
    const boughtMissing = !!cov[key]?.missing || bought.some(i => (i.contrib[P]?.missing || 0) > 0);
    const remQty = r3(Math.max(0, need.qty - boughtQty));
    const remMissing = need.missing > 0 && !boughtMissing ? need.missing : 0;
    const info = { qty: remQty, missing: remMissing, dishes: need.dishes };

    if (remQty <= 0 && !remMissing) { drop(todo); drop(removed); continue; }
    if (mode === 'absorb') {
      cov[key] = { qty: r3((cov[key]?.qty || 0) + remQty), missing: !!cov[key]?.missing || remMissing > 0 };
      drop(todo); drop(removed);
      continue;
    }
    if (removed && restore) {
      if (todo) drop(removed); // potřebu převezme existující nenakoupená položka
      else { removed.state = 'todo'; todo = removed; }
    } else if (removed) { removed.contrib[P] = info; drop(todo); continue; } // vyřazené se znovu nepřidá
    if (!todo) { todo = newListItem(need.ingredientId, need.unit, 'plan'); list.items.push(todo); }
    todo.contrib[P] = info;
  }
  // úklid prázdných položek z jídelníčku (nakoupené zůstávají)
  list.items = list.items.filter(i => i.origin === 'manual' || i.state === 'bought' || Object.keys(i.contrib).length > 0);
  list.planSigs[P] = planSig(state, plan);
}

// „Přidat vše na nákupní seznam“: jídelníček se na seznam přidá celý znovu – nakoupené ani smazané
// (mám doma) položky ho nekryjí. Pro případ, kdy byl seznam smazán/archivován.
export function addPlanFully(state, planId) {
  const plan = getPlan(state, planId);
  const list = currentList(state);
  const P = plan.id;
  delete list.coverage[P];
  delete list.planSigs[P];
  for (const it of list.items) if (it.origin !== 'manual' && it.state !== 'todo' && it.contrib) delete it.contrib[P];
  list.markedDone = false;
  reconcile(state, list, plan, 'normal', { restore: true });
}

// Výsledek: {ok:true} nebo {needsDialog:true, kind:'add'|'update'}
export function syncPlanToList(state, planId, { force = null, restore = false } = {}) {
  const plan = getPlan(state, planId);
  let list = currentList(state);
  const status = planListStatus(state, plan);
  if (!force && isPurchaseDone(list) && (status === 'add' || status === 'update')) {
    return { needsDialog: true, kind: status };
  }
  if (force === 'newList') { list = archiveList(state, { restore }); reconcile(state, list, plan, 'normal', { restore }); }
  else if (force === 'haveAll') reconcile(state, list, plan, 'absorb');
  else reconcile(state, list, plan, 'normal', { restore });
  return { ok: true };
}

export function itemQty(it) {
  if (it.origin === 'manual') return { qty: it.qty || 0, missing: it.qty ? 0 : 1 };
  let qty = 0, missing = 0;
  for (const c of Object.values(it.contrib || {})) { qty += c.qty; missing += c.missing; }
  return { qty: r3(qty), missing };
}
export function itemDishes(it) {
  const s = new Set();
  for (const c of Object.values(it.contrib || {})) c.dishes.forEach(d => s.add(d));
  return [...s];
}
export function addManualItem(state, ingredientId, qty) {
  const ing = getIngredient(state, ingredientId);
  if (!ing) throw new Error('Surovina neexistuje.');
  const list = currentList(state);
  const u = ing.unit; // množství vždy v jednotce suroviny
  const q = qty == null || qty === '' ? null : Number(qty);
  const same = list.items.find(i => i.origin === 'manual' && i.state === 'todo' && i.key === `${ingredientId}|${u}`);
  if (same) { same.qty = q == null ? same.qty : r3((same.qty || 0) + q); return same; }
  const it = newListItem(ingredientId, u, 'manual');
  it.qty = q;
  list.items.push(it);
  return it;
}
export function setItemState(state, itemId, newState) {
  const list = currentList(state);
  const it = list.items.find(i => i.id === itemId);
  if (!it) return;
  if (it.state === 'bought' && newState === 'todo') list.markedDone = false;
  it.state = newState;
}
export function markAllBought(state) {
  const list = currentList(state);
  list.items.forEach(i => { if (i.state === 'todo') i.state = 'bought'; });
  list.markedDone = true;
}
// Archivuje aktuální seznam a založí nový; nenakoupené položky se převedou.
export function archiveList(state, { restore = false } = {}) {
  const old = currentList(state);
  old.status = 'archive';
  old.archivedAt = new Date().toISOString();
  const nl = currentList(state); // založí nový
  nl.planSigs = { ...old.planSigs };
  // krytí = co už bylo nakoupeno nebo vyřazeno (mám doma)
  const cov = JSON.parse(JSON.stringify(old.coverage || {}));
  for (const it of old.items) {
    if (it.origin === 'manual' || it.state === 'todo' || (restore && it.state === 'removed')) continue;
    for (const [pid, c] of Object.entries(it.contrib || {})) {
      const pc = (cov[pid] = cov[pid] || {});
      pc[it.key] = { qty: r3((pc[it.key]?.qty || 0) + c.qty), missing: !!pc[it.key]?.missing || c.missing > 0 };
    }
  }
  nl.coverage = cov;
  nl.items = old.items.filter(i => i.state === 'todo').map(i => ({ ...JSON.parse(JSON.stringify(i)), id: uid(), carried: true }));
  return nl;
}

// ---------- Import / export ----------
export function validateImport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Neplatný soubor.');
  for (const k of ['ingredients', 'dishes', 'frozen', 'plans', 'lists']) {
    if (!Array.isArray(obj[k])) throw new Error(`V souboru chybí "${k}".`);
  }
  obj.meta = obj.meta || {};
  return obj;
}
