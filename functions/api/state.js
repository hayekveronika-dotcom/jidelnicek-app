// GET /api/state  → {rev, state, updatedAt, updatedBy, user}  (rev 0 = server je prázdný)
// PUT /api/state  {baseRev, state} → {rev, user}, nebo 409 {rev, state} když mezitím zapsal někdo jiný.
import { readCurrent, writeState, validState, json, MAX_BYTES } from '../../server/store.js';

export async function onRequestGet({ env, data }) {
  return json({ ...(await readCurrent(env.DB)), user: data.user });
}

export async function onRequestPut({ request, env, data }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Neplatný JSON.' }, 400); }
  const { baseRev, state } = body || {};
  if (!Number.isInteger(baseRev) || baseRev < 0) return json({ error: 'Chybí baseRev.' }, 400);
  if (!validState(state)) return json({ error: 'Neplatná data aplikace.' }, 400);
  const text = JSON.stringify(state);
  if (new TextEncoder().encode(text).length > MAX_BYTES) return json({ error: 'Data jsou příliš velká pro uložení na server.' }, 413);

  const rev = await writeState(env.DB, baseRev, text, data.user);
  if (rev == null) {
    const cur = await readCurrent(env.DB);
    return json({ conflict: true, rev: cur.rev, state: cur.state }, 409);
  }
  return json({ rev, user: data.user });
}
