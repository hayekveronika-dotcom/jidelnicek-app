// GET /api/state  → {rev, state, updatedAt, updatedBy, user}  (rev 0 = server je prázdný)
// PUT /api/state  {baseRev, state} → {rev, user}, nebo 409 {rev, state} když mezitím zapsal někdo jiný.
// Celý stav je jeden záznam s číslem verze; posledních HISTORY_KEEP verzí se drží v historii pro obnovu.

const ID = 'main';
const HISTORY_KEEP = 200;
const MAX_BYTES = 1_900_000; // D1: max. 2 MB na hodnotu

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS app_state_history (rev INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)'),
  ]);
  schemaReady = true;
}

async function readCurrent(db) {
  const row = await db.prepare('SELECT rev, data, updated_at, updated_by FROM app_state WHERE id = ?').bind(ID).first();
  return row
    ? { rev: row.rev, state: JSON.parse(row.data), updatedAt: row.updated_at, updatedBy: row.updated_by }
    : { rev: 0, state: null, updatedAt: null, updatedBy: null };
}

function validState(s) {
  return s && typeof s === 'object' && ['ingredients', 'dishes', 'frozen', 'plans', 'lists'].every(k => Array.isArray(s[k]));
}

export async function onRequestGet({ env, data }) {
  await ensureSchema(env.DB);
  return json({ ...(await readCurrent(env.DB)), user: data.user });
}

export async function onRequestPut({ request, env, data }) {
  await ensureSchema(env.DB);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Neplatný JSON.' }, 400); }
  const { baseRev, state } = body || {};
  if (!Number.isInteger(baseRev) || baseRev < 0) return json({ error: 'Chybí baseRev.' }, 400);
  if (!validState(state)) return json({ error: 'Neplatná data aplikace.' }, 400);
  const text = JSON.stringify(state);
  if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: 'Data jsou příliš velká pro uložení na server.' }, 413);

  const db = env.DB;
  const now = new Date().toISOString();
  const newRev = baseRev + 1;
  // Zápis jen pokud se verze na serveru nezměnila (compare-and-swap), vše v jedné transakci.
  const write = baseRev === 0
    ? db.prepare('INSERT INTO app_state (id, rev, data, updated_at, updated_by) VALUES (?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(ID, text, now, data.user)
    : db.prepare('UPDATE app_state SET rev = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND rev = ?').bind(newRev, text, now, data.user, ID, baseRev);
  const results = await db.batch([
    write,
    db.prepare('INSERT OR IGNORE INTO app_state_history (rev, data, updated_at, updated_by) SELECT rev, data, updated_at, updated_by FROM app_state WHERE id = ? AND rev = ? AND updated_at = ?').bind(ID, newRev, now),
    db.prepare('DELETE FROM app_state_history WHERE rev <= ?').bind(newRev - HISTORY_KEEP),
  ]);
  if (results[0].meta.changes !== 1) {
    const cur = await readCurrent(db);
    return json({ conflict: true, rev: cur.rev, state: cur.state }, 409);
  }
  return json({ rev: newRev, user: data.user });
}
