// MCP server pro Clauda (vlastní konektor v claude.ai): https://<aplikace>/mcp/<MCP_SECRET>
// Přístup = tajná část adresy (proměnná prostředí MCP_SECRET). Cesta /mcp musí mít v Cloudflare Access
// pravidlo Bypass, protože claude.ai se přes Access přihlásit neumí.
// Claude data čte a zapisuje jen NÁVRHY (state.proposals); potvrzují se v aplikaci.
// Protokol: MCP Streamable HTTP, bezstavově – každý POST = JSON-RPC zpráva, odpověď application/json.
import * as D from '../../app/js/domain.js';
import * as P from '../../app/js/proposals.js';
import { readCurrent, writeState, json } from '../../server/store.js';

const SERVER_INFO = { name: 'jidelnicek', title: 'Jídelníček', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';

const INSTRUCTIONS = `Rodinný jídelníček (aplikace Jídelníček). Data čti přes get_library a get_plans.
Nic nezapisuješ přímo: propose_* vytvoří NÁVRH, který uživatelka potvrdí v aplikaci (Jídelníček → Návrhy od Clauda).
Pravidla: týden má dny 0–6 (pondělí–neděle); Po–Pá jídla snidane, svacina, vecere; So–Ne navíc obed. Slot může mít víc položek.
Používej názvy pokrmů z knihovny. Nový pokrm nejdřív navrhni přes propose_dish – v propose_plan ho pak můžeš použít (přijme se dřív).
Suroviny: drž se existujících názvů; když vrátím podobné názvy, použij existující, nebo pošli confirm_new: true.
Množství suroviny vždy v její jednotce (viz get_library → ingredients[].unit), převody aplikace neumí; u nové suroviny je jednotka množství zároveň jednotkou suroviny.
Mražené pokrmy (frozen) mají omezené zásoby – kontroluj qty. Střídej pokrmy (last_planned).`;

const MEAL_ENUM = ['snidane', 'svacina', 'obed', 'vecere'];
const TOOLS = [
  {
    name: 'get_library',
    title: 'Knihovna pokrmů a zásoby',
    description: 'Vrátí knihovnu pokrmů (štítky, chuť, ovoce/zelenina, suroviny, kdy byl pokrm naposledy v jídelníčku), mražené zásoby a seznam surovin.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_plans',
    title: 'Jídelníčky',
    description: 'Vrátí tento a příští týden a historii posledních týdnů (co se jedlo).',
    inputSchema: { type: 'object', properties: { weeks_back: { type: 'integer', minimum: 0, maximum: 52, description: 'Kolik archivních týdnů vrátit (výchozí 4).' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_proposals',
    title: 'Návrhy',
    description: 'Vrátí návrhy čekající na schválení a nedávno vyřízené (přijaté/zamítnuté) i s výsledkem.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'propose_plan',
    title: 'Navrhnout jídelníček',
    description: 'Navrhne pokrmy do slotů týdne. Uživatelka návrh potvrdí v aplikaci.',
    inputSchema: {
      type: 'object',
      required: ['week', 'days'],
      properties: {
        week: { type: 'string', enum: ['current', 'next'], description: 'current = tento týden, next = příští.' },
        mode: { type: 'string', enum: ['replace', 'add'], description: 'replace (výchozí) = navržené sloty nahradí, co v nich je; add = přidá k existujícím.' },
        note: { type: 'string', description: 'Krátké zdůvodnění pro uživatelku (např. podle jídelníčku školky).' },
        days: {
          type: 'array',
          items: {
            type: 'object',
            required: ['day', 'meal', 'items'],
            properties: {
              day: { description: '0–6 (pondělí–neděle) nebo název dne.', oneOf: [{ type: 'integer', minimum: 0, maximum: 6 }, { type: 'string' }] },
              meal: { type: 'string', enum: MEAL_ENUM },
              items: {
                type: 'array',
                description: 'Položky slotu; každá má právě jedno z: dish, frozen, ingredient.',
                items: {
                  type: 'object',
                  properties: {
                    dish: { type: 'string', description: 'Název pokrmu z knihovny.' },
                    frozen: { type: 'string', description: 'Název mraženého pokrmu.' },
                    count: { type: 'integer', minimum: 1, description: 'Počet kusů/porcí mraženého.' },
                    ingredient: { type: 'string', description: 'Samostatná surovina (např. jablko ke svačině).' },
                    qty: { type: 'number' },
                    unit: { type: 'string', enum: D.UNITS, description: 'Musí být jednotka suroviny.' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'propose_dish',
    title: 'Navrhnout pokrm',
    description: 'Navrhne nový pokrm do knihovny (i s novými surovinami). Uživatelka ho potvrdí v aplikaci.',
    inputSchema: {
      type: 'object',
      required: ['name', 'tags', 'ingredients'],
      properties: {
        name: { type: 'string' },
        tags: { type: 'array', items: { type: 'string', enum: MEAL_ENUM }, minItems: 1 },
        taste: { type: 'string', enum: ['sladke', 'slane'] },
        contains_fruit: { type: 'boolean' },
        contains_veg: { type: 'boolean' },
        ingredients: {
          type: 'array', minItems: 1,
          items: {
            type: 'object', required: ['name'],
            properties: {
              name: { type: 'string' },
              qty: { type: 'number' },
              unit: { type: 'string', enum: D.UNITS },
              category: { type: 'string', enum: D.CATEGORIES, description: 'Jen u nové suroviny.' },
              confirm_new: { type: 'boolean', description: 'Opravdu nová surovina, i když existuje podobná.' },
            },
          },
        },
        recipe: { type: 'string', description: 'Postup nebo odkaz.' },
        prep_time_min: { type: 'integer' },
        servings: { type: 'integer' },
        thermomix: { type: 'boolean' },
        restrictions: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      },
    },
  },
  {
    name: 'propose_ingredient',
    title: 'Navrhnout surovinu',
    description: 'Navrhne novou surovinu. Kontroluje duplicity (stejný nebo podobný název).',
    inputSchema: {
      type: 'object', required: ['name'],
      properties: {
        name: { type: 'string' },
        unit: { type: 'string', enum: D.UNITS },
        category: { type: 'string', enum: D.CATEGORIES },
        confirm_new: { type: 'boolean' },
        note: { type: 'string' },
      },
    },
  },
  {
    name: 'withdraw_proposal',
    title: 'Stáhnout návrh',
    description: 'Stáhne vlastní návrh, který ještě čeká na schválení.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    annotations: { destructiveHint: true },
  },
];

// ---------- data ----------

async function load(env) {
  const cur = await readCurrent(env.DB);
  if (!cur.state) throw new Error('Aplikace ještě nemá data na serveru (otevřete ji a přihlaste se).');
  return { rev: cur.rev, state: D.migrateState(cur.state) };
}

// Načte stav, provede změnu a zapíše (při souběžném zápisu z aplikace to zkusí znovu).
async function mutate(env, fn) {
  for (let i = 0; i < 4; i++) {
    const { rev, state } = await load(env);
    const result = fn(state);
    if ((await writeState(env.DB, rev, state, 'claude')) != null) return result;
  }
  throw new Error('Data se právě mění, zkuste to znovu.');
}

const qtyText = (q, u) => (q != null ? ` ${q}${u ? ' ' + u : ''}` : '');

function library(s) {
  const ingName = id => D.getIngredient(s, id)?.name || '?';
  return {
    dishes: s.dishes.filter(d => !d.deleted).sort(D.byName).map(d => ({
      name: d.name,
      tags: d.tags,
      taste: d.taste || null,
      contains_fruit: !!d.contains?.fruit,
      contains_veg: !!d.contains?.veg,
      ingredients: d.items.map(it => ingName(it.ingredientId) + qtyText(it.qty, it.unit)).join(', '),
      prep_time_min: d.prepTime || null,
      servings: d.servings || null,
      thermomix: !!d.thermomix,
      restrictions: d.restrictions || [],
      has_recipe: !!d.recipe,
      last_planned: D.lastUsed(s, d.id),
    })),
    frozen: s.frozen.filter(f => !f.deleted).sort(D.byName).map(f => ({ name: f.name, qty: f.qty, unit: f.unit, tags: f.tags })),
    ingredients: [...s.ingredients].sort(D.byName).map(i => ({ name: i.name, unit: i.unit, category: i.category })),
  };
}

function entryName(s, e) {
  if (e.type === 'dish') { const d = D.getDish(s, e.refId); return d ? d.name + (d.deleted ? ' (smazaný)' : '') : '?'; }
  if (e.type === 'frozen') { const f = D.getFrozen(s, e.refId); return (f ? f.name : '?') + ' (mražené' + (e.count > 1 ? `, ${e.count}×` : '') + ')'; }
  const i = D.getIngredient(s, e.refId);
  return (i ? i.name : '?') + qtyText(e.qty, e.unit);
}

function plans(s, weeksBack = 4) {
  const archived = s.plans.filter(p => p.status === 'archive').sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, weeksBack);
  const order = { current: 0, next: 1 };
  const live = s.plans.filter(p => p.status !== 'archive').sort((a, b) => order[a.status] - order[b.status]);
  return [...live, ...archived].map(p => ({
    week: D.fmtWeek(p.weekStart),
    week_start: p.weekStart,
    status: p.status === 'current' ? 'tento týden' : p.status === 'next' ? 'příští týden' : 'archiv',
    days: D.DAY_NAMES.map((name, di) => {
      const meals = {};
      for (const m of D.slotsForDay(di)) {
        const items = D.slotItems(p, D.slotKey(di, m));
        if (items.length) meals[m] = items.map(e => entryName(s, e));
      }
      return { day: di, name, meals };
    }).filter(d => Object.keys(d.meals).length),
  }));
}

function proposals(s) {
  const list = P.proposalsOf(s);
  const pending = list.filter(p => p.status === 'pending');
  const resolved = list.filter(p => p.status !== 'pending').sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt)).slice(0, 10);
  return [...pending, ...resolved].map(p => ({ id: p.id, kind: p.kind, status: p.status, created: p.createdAt, note: p.note || undefined, ...P.describeProposal(s, p), result: p.result }));
}

// ---------- nástroje ----------

const text = (data, isError = false) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }], ...(isError ? { isError: true } : {}) });

async function propose(env, kind, prepare, args) {
  const r = await mutate(env, s => {
    const p = P.addProposal(s, kind, prepare(s, args), { note: args.note });
    return { id: p.id, ...P.describeProposal(s, p) };
  });
  return text({ ok: true, message: 'Návrh čeká na schválení v aplikaci.', ...r });
}

async function callTool(env, name, args = {}) {
  switch (name) {
    case 'get_library': return text(library((await load(env)).state));
    case 'get_plans': return text(plans((await load(env)).state, Number.isInteger(args.weeks_back) ? args.weeks_back : 4));
    case 'list_proposals': return text(proposals((await load(env)).state));
    case 'propose_plan': return propose(env, 'plan', P.preparePlan, args);
    case 'propose_dish': return propose(env, 'dish', P.prepareDish, args);
    case 'propose_ingredient': return propose(env, 'ingredient', P.prepareIngredient, args);
    case 'withdraw_proposal':
      await mutate(env, s => {
        const p = P.getProposal(s, args.id);
        if (!p || p.status !== 'pending') throw new Error('Takový čekající návrh není.');
        s.proposals = s.proposals.filter(x => x !== p);
      });
      return text({ ok: true, message: 'Návrh stažen.' });
    default: throw Object.assign(new Error(`Neznámý nástroj: ${name}`), { rpc: -32602 });
  }
}

// ---------- JSON-RPC ----------

async function handle(env, msg) {
  const isRequest = msg && typeof msg === 'object' && msg.id !== undefined && msg.id !== null;
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: isRequest ? msg.id : null, error: { code: -32600, message: 'Invalid Request' } };
  }
  if (!isRequest) return null; // notifikace (např. notifications/initialized)
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  try {
    switch (msg.method) {
      case 'initialize':
        return ok({
          protocolVersion: msg.params?.protocolVersion || DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOLS });
      case 'tools/call':
        try {
          return ok(await callTool(env, msg.params?.name, msg.params?.arguments || {}));
        } catch (e) {
          if (e.rpc) throw e;
          return ok(text(e.message || String(e), true)); // chyba nástroje → Claude ji uvidí a opraví vstup
        }
      default:
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  } catch (e) {
    return { jsonrpc: '2.0', id: msg.id, error: { code: e.rpc || -32603, message: e.message || 'Internal error' } };
  }
}

function secretOk(given, expected) {
  if (!expected || expected.length < 32 || typeof given !== 'string' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function onRequest({ request, env, params }) {
  if (!secretOk(params.secret, env.MCP_SECRET)) return new Response('Not found', { status: 404 });
  if (!env.DB) return json({ error: 'Chybí propojení s databází D1 (binding DB).' }, 500);
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });

  let body;
  try { body = await request.json(); } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  if (Array.isArray(body)) {
    const out = [];
    for (const m of body) { const r = await handle(env, m); if (r) out.push(r); }
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await handle(env, body);
  return out ? json(out) : new Response(null, { status: 202 });
}
