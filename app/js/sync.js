// Synchronizace se serverem (Cloudflare Pages Functions + D1, /api/state).
// Server drží celý stav s číslem verze (rev). Zápis projde, jen když klient zná aktuální rev;
// jinak server vrátí 409 s aktuálním stavem a klient ho sloučí (merge.js) a zkusí to znovu.
// Data se dál ukládají i lokálně, takže aplikace funguje offline.
import { loadSyncMeta, saveSyncMeta } from './db.js';
import { mergeStates, hasContent } from './merge.js';

const API = './api/state';
const PUSH_DELAY = 1500;
const POLL_MS = 30000;

let meta = { rev: 0, base: null, dirty: false, replace: false, lastSync: null, user: null };
let hooks = null; // {getState, setState, onStatus}
let status = 'starting'; // starting | ok | pending | syncing | offline | login | local | error
let errorMsg = '';
let seq = 0;          // počítadlo lokálních změn
let running = null;   // probíhající synchronizace
let again = false;
let pushTimer = null;

const clone = o => JSON.parse(JSON.stringify(o));
function setStatus(s, msg = '') { status = s; errorMsg = msg; hooks?.onStatus?.(getSyncInfo()); }
export const getSyncInfo = () => ({ status, error: errorMsg, lastSync: meta.lastSync, user: meta.user, dirty: meta.dirty });

async function api(method, body) {
  const res = await fetch(API, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'manual', // vypršené přihlášení Cloudflare Access = přesměrování
  });
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) throw Object.assign(new Error('login'), { kind: 'login' });
  if (res.status === 404 || res.status === 405 || res.status === 501) throw Object.assign(new Error('local'), { kind: 'local' });
  let data = null;
  try { data = await res.json(); } catch { /* nic */ }
  if (res.status === 409) return { conflict: true, ...data };
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Chyba serveru (${res.status})`), { kind: 'error' });
  if (!data || typeof data.rev !== 'number') throw Object.assign(new Error('local'), { kind: 'local' });
  return data;
}

function applyRemote(remoteState) {
  hooks.setState(clone(remoteState));
}

async function cycle() {
  for (let round = 0; round < 5; round++) {
    const startSeq = seq;
    const local = clone(hooks.getState());

    if (meta.dirty) {
      const r = await api('PUT', { baseRev: meta.rev, state: local });
      if (!r.conflict) {
        meta.rev = r.rev; meta.base = local; meta.replace = false;
        meta.user = r.user || meta.user;
        meta.dirty = seq !== startSeq; // mezitím další změna?
        meta.lastSync = new Date().toISOString();
        await saveSyncMeta(meta);
        if (!meta.dirty) return;
        continue;
      }
      // konflikt: na serveru je novější verze
      if (meta.replace) { meta.rev = r.rev; continue; } // import/smazání: přepsat server
      const current = clone(hooks.getState()); // aktuální lokální stav (i se změnami během požadavku)
      const merged = mergeStates(meta.base, current, r.state);
      hooks.setState(merged);
      meta.rev = r.rev; meta.base = r.state; meta.dirty = true;
      await saveSyncMeta(meta);
      continue;
    }

    const r = await api('GET');
    meta.user = r.user || meta.user;
    if (r.rev === 0) {
      // server je prázdný: nahrát data z tohoto zařízení
      if (hasContent(local)) { meta.dirty = true; continue; }
      meta.lastSync = new Date().toISOString();
      await saveSyncMeta(meta);
      return;
    }
    if (r.rev !== meta.rev) {
      if (seq !== startSeq) {
        // během stahování přibyla lokální změna → sloučit
        hooks.setState(mergeStates(meta.base, clone(hooks.getState()), r.state));
        meta.dirty = true;
      } else if (!meta.base && hasContent(local)) {
        // první synchronizace zařízení, které už má vlastní data → spojit obojí
        hooks.setState(mergeStates(null, local, r.state));
        meta.dirty = true;
      } else {
        applyRemote(r.state);
      }
      meta.rev = r.rev; meta.base = r.state;
    }
    meta.lastSync = new Date().toISOString();
    await saveSyncMeta(meta);
    if (!meta.dirty) return;
  }
}

export function syncNow() {
  if (!hooks || status === 'local') return Promise.resolve();
  if (running) { again = true; return running; }
  if (!navigator.onLine) { setStatus('offline'); return Promise.resolve(); }
  setStatus('syncing');
  running = (async () => {
    try {
      do { again = false; await cycle(); } while (again);
      setStatus(meta.dirty ? 'pending' : 'ok');
    } catch (e) {
      if (e.kind === 'login') setStatus('login');
      else if (e.kind === 'local') setStatus('local');
      else if (!navigator.onLine || e instanceof TypeError) setStatus('offline');
      else setStatus('error', e.message);
    } finally {
      running = null;
    }
  })();
  return running;
}

// Volá se po každé lokální změně stavu.
export function markDirty() {
  seq++;
  if (!meta.dirty) { meta.dirty = true; saveSyncMeta(meta); }
  if (status === 'local') return;
  if (status === 'ok') setStatus('pending');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, PUSH_DELAY);
}

// Import zálohy / smazání dat: server se přepíše tímto stavem (bez slučování).
export function markReplace() {
  meta.replace = true;
  markDirty();
}

export async function initSync(h) {
  hooks = h;
  const saved = await loadSyncMeta();
  if (saved) meta = { ...meta, ...saved };
  else meta.dirty = hasContent(h.getState()); // existující data z doby před synchronizací
  await syncNow();
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setStatus('offline'));
}
