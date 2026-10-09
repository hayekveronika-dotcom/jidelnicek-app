// Tříbodové sloučení stavu (base = poslední synchronizovaná verze, local, remote).
// Čisté funkce bez DOM – použitelné i na serveru (MCP).
//
// Pravidla:
// - co změnila jen jedna strana, se převezme;
// - objekty se slučují po polích, pole objektů s `id` po položkách (pokrmy, suroviny, týdny, seznamy, položky seznamu);
// - když obě strany změnily totéž pole, vyhrává local (pozdější zápis);
// - smazání vs. úprava: zůstane upravená verze;
// - zásoby mražených (`frozen[].qty`) se sčítají jako rozdíly (5 → 4 a 5 → 3 dá 2).

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIdArray = v => Array.isArray(v) && v.every(x => isObj(x) && typeof x.id === 'string');

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function mergeById(b, l, r, path) {
  const bm = new Map((b || []).map(x => [x.id, x]));
  const lm = new Map(l.map(x => [x.id, x]));
  const rm = new Map(r.map(x => [x.id, x]));
  const out = [];
  // pořadí: remote, pak nové lokální
  const ids = [...r.map(x => x.id), ...l.map(x => x.id).filter(id => !rm.has(id))];
  for (const id of ids) {
    const v = merge3(bm.get(id), lm.get(id), rm.get(id), path + '[]');
    if (v !== undefined) out.push(v);
  }
  return out;
}

export function merge3(b, l, r, path = '') {
  if (deepEqual(l, r)) return l;
  if (deepEqual(l, b)) return r;
  if (deepEqual(r, b)) return l;
  // obě strany změnily
  if (l === undefined) return r; // local smazal, remote upravil → nechat úpravu
  if (r === undefined) return l;
  if (isObj(l) && isObj(r)) {
    const bo = isObj(b) ? b : {};
    const out = {};
    for (const k of new Set([...Object.keys(r), ...Object.keys(l)])) {
      const v = merge3(bo[k], l[k], r[k], path ? `${path}.${k}` : k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (isIdArray(l) && isIdArray(r) && (b === undefined || isIdArray(b))) return mergeById(b, l, r, path);
  if (path === 'frozen[].qty' && typeof b === 'number' && typeof l === 'number' && typeof r === 'number') {
    return Math.round((r + (l - b)) * 1000) / 1000;
  }
  return l;
}

// Opraví duplicity, které vzniknou souběžnou prací (stejný týden založený na dvou zařízeních,
// dva aktuální nákupní seznamy, stejná položka seznamu dvakrát).
export function normalizeMerged(state) {
  // týdny: jeden živý jídelníček na weekStart+status
  const keep = new Map();
  state.plans = state.plans.filter(p => {
    if (p.status === 'archive') return true;
    const k = `${p.status}|${p.weekStart}`;
    const main = keep.get(k);
    if (!main) { keep.set(k, p); return true; }
    for (const [slot, entries] of Object.entries(p.slots || {})) {
      const target = (main.slots[slot] = main.slots[slot] || []);
      for (const e of entries) if (!target.some(t => deepEqual(t, e))) target.push(e);
    }
    return false;
  });
  // víc „current“ jídelníčků/dalších s různým týdnem: nechá nejnovější
  for (const st of ['current', 'next']) {
    const ps = state.plans.filter(p => p.status === st).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    ps.slice(1).forEach(p => { p.status = 'archive'; p.archivedAt = p.archivedAt || new Date().toISOString(); });
  }
  // nákupní seznamy: jeden aktuální
  const cur = state.lists.filter(l => l.status === 'current');
  if (cur.length > 1) {
    const [main, ...rest] = cur;
    for (const l of rest) {
      for (const it of l.items) if (!main.items.some(x => x.id === it.id)) main.items.push(it);
      main.planSigs = { ...(l.planSigs || {}), ...(main.planSigs || {}) };
      main.coverage = { ...(l.coverage || {}), ...(main.coverage || {}) };
    }
    state.lists = state.lists.filter(l => !rest.includes(l));
  }
  // položky seznamu z jídelníčku se stejnou surovinou a stavem → jeden řádek
  for (const l of state.lists) {
    const seen = new Map();
    l.items = l.items.filter(it => {
      if (it.origin !== 'plan') return true;
      const k = `${it.key}|${it.state}`;
      const main = seen.get(k);
      if (!main) { seen.set(k, it); return true; }
      main.contrib = { ...(it.contrib || {}), ...(main.contrib || {}) };
      return false;
    });
  }
  return state;
}

export function mergeStates(base, local, remote) {
  const merged = merge3(base || undefined, local, remote);
  return normalizeMerged(JSON.parse(JSON.stringify(merged)));
}

// Má zařízení vlastní data (ne jen prázdné týdny založené při startu)?
export function hasContent(s) {
  if (!s) return false;
  return s.ingredients.length > 0 || s.dishes.length > 0 || s.frozen.length > 0
    || s.plans.some(p => Object.values(p.slots || {}).some(v => v && v.length))
    || s.lists.some(l => l.items.length > 0);
}
