// Návrhy od Clauda (MCP): Claude nic nezapisuje přímo, jen přidá návrh do state.proposals.
// Veronika návrh v aplikaci přijme (provede se přes funkce z domain.js) nebo zamítne.
// Čisté funkce bez DOM – používá je aplikace i server (functions/mcp).
//
// proposal: {id, kind: 'ingredient'|'dish'|'plan', data, note, source, createdAt,
//            status: 'pending'|'accepted'|'rejected', resolvedAt, result: [zprávy]}
import * as D from './domain.js';

const KEEP_RESOLVED = 30;
const err = msg => { throw new Error(msg); };

export const proposalsOf = s => (s.proposals = s.proposals || []);
export const pendingProposals = s => proposalsOf(s).filter(p => p.status === 'pending');
export const getProposal = (s, id) => proposalsOf(s).find(p => p.id === id);

const MEAL_ALIASES = { snidane: 'snidane', svacina: 'svacina', obed: 'obed', vecere: 'vecere' };
const DAY_ALIASES = ['pondeli', 'utery', 'streda', 'ctvrtek', 'patek', 'sobota', 'nedele'];

function parseDay(v) {
  if (Number.isInteger(v) && v >= 0 && v <= 6) return v;
  const i = DAY_ALIASES.indexOf(D.normalize(String(v)));
  if (i < 0) err(`Neznámý den „${v}“ (použij 0–6 = pondělí–neděle nebo název dne).`);
  return i;
}
function parseMeal(v, day) {
  const m = MEAL_ALIASES[D.normalize(String(v))];
  if (!m) err(`Neznámé jídlo „${v}“ (snidane, svacina, obed, vecere).`);
  if (!D.slotsForDay(day).includes(m)) err(`${D.DAY_NAMES[day]}: jídlo „${D.TAG_LABEL[m]}“ v jídelníčku není (oběd jen o víkendu).`);
  return m;
}
function parseUnit(u, allowed = D.UNITS) {
  if (u == null || u === '') return null;
  if (!allowed.includes(u)) err(`Neznámá jednotka „${u}“ (povolené: ${allowed.join(', ')}).`);
  return u;
}
// Množství musí být v jednotce suroviny (převody aplikace neumí).
function sameUnit(r, unit) {
  if (unit != null && unit !== '' && unit !== r.ingUnit) err(`Surovina „${r.name}“ se vede v jednotce „${r.ingUnit}“ – zadej množství v „${r.ingUnit}“ (přepočti), jiné jednotky nejsou povolené.`);
  return r.ingUnit;
}
const findDishByName = (s, name) => s.dishes.find(d => !d.deleted && D.normalize(d.name) === D.normalize(name));
const findFrozenByName = (s, name) => s.frozen.find(f => !f.deleted && D.normalize(f.name) === D.normalize(name));
const pendingOfKind = (s, kind, name) =>
  pendingProposals(s).find(p => p.kind === kind && D.normalize(p.data.name) === D.normalize(name));

// Surovina podle názvu: existující → id; podobná → chyba (pokud není confirmNew); jinak nová.
function resolveIngredient(s, name, { confirmNew = false, unit = null, category = null } = {}) {
  name = (name || '').trim();
  if (!name) err('Chybí název suroviny.');
  const exact = D.findExactIngredient(s, name);
  if (exact) return { ingredientId: exact.id, name: exact.name, ingUnit: exact.unit };
  const pend = pendingOfKind(s, 'ingredient', name);
  if (pend) return { ingredientId: null, name: pend.data.name, ingUnit: pend.data.unit };
  if (!confirmNew) {
    const sim = D.findSimilarIngredients(s, name);
    if (sim.length) err(`Surovina „${name}“ není v seznamu, ale podobné existují: ${sim.map(i => `„${i.name}“`).join(', ')}. Použij existující název, nebo pošli znovu s confirm_new: true.`);
  }
  if (category && !D.CATEGORIES.includes(category)) err(`Neznámá kategorie „${category}“ (povolené: ${D.CATEGORIES.join(', ')}).`);
  return { ingredientId: null, name, ingUnit: unit || 'ks', newIngredient: { unit: unit || 'ks', category: category || 'Ostatní' } };
}

// ---------- Příprava návrhů (validace podle pravidel aplikace) ----------

export function prepareIngredient(s, { name, unit, category, confirm_new }) {
  name = (name || '').trim();
  if (!name) err('Chybí název suroviny.');
  const exact = D.findExactIngredient(s, name);
  if (exact) err(`Surovina „${exact.name}“ už existuje.`);
  if (pendingOfKind(s, 'ingredient', name)) err(`Surovina „${name}“ už čeká na schválení.`);
  if (!confirm_new) {
    const sim = D.findSimilarIngredients(s, name);
    if (sim.length) err(`Podobné suroviny už existují: ${sim.map(i => `„${i.name}“`).join(', ')}. Pokud jde opravdu o jinou surovinu, pošli znovu s confirm_new: true.`);
  }
  if (category && !D.CATEGORIES.includes(category)) err(`Neznámá kategorie „${category}“ (povolené: ${D.CATEGORIES.join(', ')}).`);
  return { name, unit: parseUnit(unit) || 'ks', category: category || 'Ostatní' };
}

export function prepareDish(s, input) {
  const name = (input.name || '').trim();
  if (!name) err('Chybí název pokrmu.');
  if (findDishByName(s, name)) err(`Pokrm „${name}“ už v knihovně je.`);
  if (pendingOfKind(s, 'dish', name)) err(`Pokrm „${name}“ už čeká na schválení.`);
  const tags = [...new Set((input.tags || []).map(t => MEAL_ALIASES[D.normalize(String(t))] || err(`Neznámý štítek „${t}“ (snidane, svacina, obed, vecere).`)))];
  if (!tags.length) err('Pokrm potřebuje aspoň 1 štítek (snidane, svacina, obed, vecere).');
  if (input.taste != null && !['sladke', 'slane'].includes(input.taste)) err('Chuť je „sladke“ nebo „slane“.');
  const items = (input.ingredients || []).map(it => {
    const r = resolveIngredient(s, it.name, { confirmNew: !!it.confirm_new, unit: parseUnit(it.unit), category: it.category });
    const qty = it.qty == null || it.qty === '' ? null : Number(it.qty);
    if (qty != null && !(qty > 0)) err(`Množství u „${it.name}“ musí být kladné číslo.`);
    const { ingUnit, ...ref } = r;
    return { ...ref, qty, unit: qty == null ? null : sameUnit(r, it.unit) };
  });
  if (!items.length) err('Pokrm potřebuje aspoň 1 surovinu.');
  return {
    name, tags, taste: input.taste || null,
    contains: { fruit: !!input.contains_fruit, veg: !!input.contains_veg },
    items,
    prepTime: input.prep_time_min || null, servings: input.servings || null,
    recipe: (input.recipe || '').trim(), thermomix: !!input.thermomix,
    restrictions: (input.restrictions || []).filter(Boolean),
  };
}

export function preparePlan(s, { week, mode, days }) {
  const plan = s.plans.find(p => p.status === (week === 'next' ? 'next' : week === 'current' ? 'current' : null));
  if (!plan) err('Týden je „current“ (tento) nebo „next“ (příští).');
  if (mode && !['add', 'replace'].includes(mode)) err('mode je „add“ (přidat k tomu, co ve dni už je) nebo „replace“ (nahradit).');
  if (!Array.isArray(days) || !days.length) err('Chybí sloty (days).');
  const frozenNeed = {};
  const slots = days.map(d => {
    const day = parseDay(d.day);
    const meal = parseMeal(d.meal, day);
    const items = (d.items || []).map(it => {
      if (it.dish) {
        const dish = findDishByName(s, it.dish);
        if (dish) return { type: 'dish', refId: dish.id, name: dish.name };
        if (pendingOfKind(s, 'dish', it.dish)) return { type: 'dish', refId: null, name: it.dish.trim() };
        err(`Pokrm „${it.dish}“ není v knihovně. Nejdřív ho navrhni přes propose_dish, nebo použij existující název.`);
      }
      if (it.frozen) {
        const f = findFrozenByName(s, it.frozen);
        if (!f) err(`Mražený pokrm „${it.frozen}“ v mrazáku není.`);
        const count = Math.max(1, Math.round(Number(it.count) || 1));
        frozenNeed[f.id] = (frozenNeed[f.id] || 0) + count;
        if (frozenNeed[f.id] > f.qty) err(`${f.name}: v mrazáku je jen ${f.qty} ${f.unit}.`);
        return { type: 'frozen', refId: f.id, name: f.name, count };
      }
      if (it.ingredient) {
        const r = resolveIngredient(s, it.ingredient);
        if (r.newIngredient) err(`Surovina „${it.ingredient}“ není v seznamu. Navrhni ji přes propose_ingredient, nebo použij existující název.`);
        const qty = it.qty == null || it.qty === '' ? null : Number(it.qty);
        return { type: 'ingredient', refId: r.ingredientId, name: r.name, qty, unit: qty == null ? null : sameUnit(r, it.unit) };
      }
      err('Každá položka potřebuje „dish“, „frozen“ nebo „ingredient“.');
    });
    if (!items.length) err(`${D.DAY_NAMES[day]} ${D.TAG_LABEL[meal]}: chybí položky.`);
    return { day, meal, items };
  });
  return { weekStart: plan.weekStart, mode: mode || 'replace', slots };
}

export function addProposal(s, kind, data, { note = '', source = 'claude' } = {}) {
  const p = { id: D.uid(), kind, data, note: (note || '').trim(), source, createdAt: new Date().toISOString(), status: 'pending' };
  proposalsOf(s).push(p);
  // starší vyřízené návrhy se mažou
  const resolved = s.proposals.filter(x => x.status !== 'pending');
  if (resolved.length > KEEP_RESOLVED) {
    const drop = new Set(resolved.sort((a, b) => a.resolvedAt.localeCompare(b.resolvedAt)).slice(0, resolved.length - KEEP_RESOLVED));
    s.proposals = s.proposals.filter(x => !drop.has(x));
  }
  return p;
}

// ---------- Přijetí / zamítnutí (v aplikaci) ----------

function ensureIngredient(s, ref) {
  if (ref.ingredientId && D.getIngredient(s, ref.ingredientId)) return ref.ingredientId;
  const exact = D.findExactIngredient(s, ref.name);
  if (exact) return exact.id;
  const nw = ref.newIngredient || {};
  return D.createIngredient(s, { name: ref.name, unit: nw.unit, category: nw.category }, { force: true }).ingredient.id;
}

// Vrací {ok, messages}. Chyby jednotlivých položek se hlásí, zbytek se provede.
export function acceptProposal(s, id) {
  const p = getProposal(s, id);
  if (!p || p.status !== 'pending') return { ok: false, messages: ['Návrh už byl vyřízen.'] };
  const msgs = [];
  const d = p.data;
  let dishId = null;
  if (p.kind === 'ingredient') {
    const r = D.createIngredient(s, d, { force: true });
    if (!r.ok) msgs.push(`Surovina „${r.matches[0].name}“ už existuje.`);
    else msgs.push(`Přidána surovina „${d.name}“.`);
  } else if (p.kind === 'dish') {
    if (findDishByName(s, d.name)) return { ok: false, messages: [`Pokrm „${d.name}“ už v knihovně je.`] };
    const items = d.items.map(it => ({ ingredientId: ensureIngredient(s, it), qty: it.qty, unit: it.unit }));
    dishId = D.saveDish(s, { ...d, items }).id;
    msgs.push(`Přidán pokrm „${d.name}“.`);
  } else if (p.kind === 'plan') {
    const plan = s.plans.find(x => x.weekStart === d.weekStart && x.status !== 'archive');
    if (!plan) return { ok: false, messages: ['Týden z návrhu už skončil.'] };
    let added = 0;
    for (const slot of d.slots) {
      const key = D.slotKey(slot.day, slot.meal);
      if (d.mode === 'replace') D.clearSlot(s, plan.id, key);
      for (const it of slot.items) {
        let refId = it.refId;
        if (it.type === 'dish' && !(refId && D.getDish(s, refId))) refId = findDishByName(s, it.name)?.id;
        if (it.type === 'ingredient' && !(refId && D.getIngredient(s, refId))) refId = D.findExactIngredient(s, it.name)?.id;
        const where = `${D.DAY_NAMES[slot.day]} ${D.TAG_LABEL[slot.meal].toLowerCase()}`;
        if (!refId) { msgs.push(`${where}: „${it.name}“ nenalezen, vynecháno.`); continue; }
        const r = D.assignSlot(s, plan.id, key, { type: it.type, refId, count: it.count, qty: it.qty, unit: it.unit });
        if (r.ok) added++; else msgs.push(`${where}: ${r.error}`);
      }
    }
    msgs.unshift(`Do jídelníčku ${added === 1 ? 'přidána 1 položka' : added >= 2 && added <= 4 ? `přidány ${added} položky` : `přidáno ${added} položek`}.`);
  }
  p.status = 'accepted';
  p.resolvedAt = new Date().toISOString();
  p.result = msgs;
  return { ok: true, messages: msgs, dishId };
}

export function rejectProposal(s, id) {
  const p = getProposal(s, id);
  if (!p || p.status !== 'pending') return;
  p.status = 'rejected';
  p.resolvedAt = new Date().toISOString();
}

// Čitelný popis návrhu (aplikace i odpověď pro Clauda)
export function describeProposal(s, p) {
  const d = p.data;
  if (p.kind === 'ingredient') return { title: `Nová surovina: ${d.name}`, lines: [`${d.category} · ${d.unit}`] };
  if (p.kind === 'dish') {
    const tags = d.tags.map(t => D.TAG_LABEL[t]).join(', ');
    const lines = [tags + (d.taste ? ` · ${d.taste === 'sladke' ? 'sladké' : 'slané'}` : '')];
    lines.push(d.items.map(it => `${it.name}${it.qty != null ? ` ${it.qty} ${it.unit || ''}`.trimEnd() : ''}${it.newIngredient ? ' (nová surovina)' : ''}`).join(', '));
    if (d.recipe) lines.push(d.recipe.length > 140 ? d.recipe.slice(0, 140) + '…' : d.recipe);
    return { title: `Nový pokrm: ${d.name}`, lines };
  }
  const plan = s.plans.find(x => x.weekStart === d.weekStart);
  const lines = d.slots.map(sl => `${D.DAY_NAMES[sl.day]} ${D.TAG_LABEL[sl.meal].toLowerCase()}: ${sl.items.map(it => it.name + (it.type === 'frozen' && it.count > 1 ? ` ${it.count}×` : '') + (it.type === 'ingredient' && it.qty != null ? ` ${it.qty} ${it.unit || ''}`.trimEnd() : '')).join(', ')}`);
  return { title: `Jídelníček ${D.fmtWeek(d.weekStart)}${plan && plan.status !== 'archive' ? '' : ' (týden skončil)'} · ${d.mode === 'add' ? 'přidat' : 'nahradit dny'}`, lines };
}
