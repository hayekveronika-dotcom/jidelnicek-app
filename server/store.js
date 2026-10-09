// Stav aplikace v D1: jeden záznam s číslem verze (rev) + historie posledních verzí.
// Používá /api/state (aplikace) i /mcp (Claude).

const ID = 'main';
const HISTORY_KEEP = 200;
export const MAX_BYTES = 1_900_000; // D1: max. 2 MB na hodnotu

let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS app_state_history (rev INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)'),
  ]);
  schemaReady = true;
}

export async function readCurrent(db) {
  await ensureSchema(db);
  const row = await db.prepare('SELECT rev, data, updated_at, updated_by FROM app_state WHERE id = ?').bind(ID).first();
  return row
    ? { rev: row.rev, state: JSON.parse(row.data), updatedAt: row.updated_at, updatedBy: row.updated_by }
    : { rev: 0, state: null, updatedAt: null, updatedBy: null };
}

// Zapíše stav, jen pokud je na serveru pořád verze baseRev (compare-and-swap), vše v jedné transakci.
// Vrací nové rev, nebo null při konfliktu.
export async function writeState(db, baseRev, state, user) {
  await ensureSchema(db);
  const text = typeof state === 'string' ? state : JSON.stringify(state);
  const now = new Date().toISOString();
  const newRev = baseRev + 1;
  const write = baseRev === 0
    ? db.prepare('INSERT INTO app_state (id, rev, data, updated_at, updated_by) VALUES (?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(ID, text, now, user)
    : db.prepare('UPDATE app_state SET rev = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND rev = ?').bind(newRev, text, now, user, ID, baseRev);
  const results = await db.batch([
    write,
    db.prepare('INSERT OR IGNORE INTO app_state_history (rev, data, updated_at, updated_by) SELECT rev, data, updated_at, updated_by FROM app_state WHERE id = ? AND rev = ? AND updated_at = ?').bind(ID, newRev, now),
    db.prepare('DELETE FROM app_state_history WHERE rev <= ?').bind(newRev - HISTORY_KEEP),
  ]);
  return results[0].meta.changes === 1 ? newRev : null;
}

export function validState(s) {
  return s && typeof s === 'object' && ['ingredients', 'dishes', 'frozen', 'plans', 'lists'].every(k => Array.isArray(s[k]));
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
