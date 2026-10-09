// Uložení stavu do IndexedDB (fallback localStorage). Celý stav je jeden záznam –
// data jsou malá a entity mají vlastní ID, takže pozdější přechod na server/sdílení
// znamená jen vyměnit tuto vrstvu.
const DB_NAME = 'jidelnicek-app';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'jidelnicek-app-state';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let dbPromise = null;
const db = () => (dbPromise = dbPromise || openDb());

async function loadKey(key) {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    try { const s = localStorage.getItem(`${LS_KEY}:${key}`) ?? (key === KEY ? localStorage.getItem(LS_KEY) : null); return s ? JSON.parse(s) : null; } catch { return null; }
  }
}

async function saveKey(key, value) {
  const copy = JSON.parse(JSON.stringify(value));
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(copy, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { localStorage.setItem(`${LS_KEY}:${key}`, JSON.stringify(copy)); } catch { /* nic */ }
  }
}

export const loadState = () => loadKey(KEY);
export const saveState = state => saveKey(KEY, state);
// Stav synchronizace: {rev, base (poslední stav ze serveru), dirty, replace, lastSync, user}
export const loadSyncMeta = () => loadKey('sync');
export const saveSyncMeta = meta => saveKey('sync', meta);

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* nic */ }
}
