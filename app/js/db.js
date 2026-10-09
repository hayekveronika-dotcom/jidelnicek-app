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

export async function loadState() {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
  }
}

export async function saveState(state) {
  const copy = JSON.parse(JSON.stringify(state));
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(copy, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { localStorage.setItem(LS_KEY, JSON.stringify(copy)); } catch { /* nic */ }
  }
}

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* nic */ }
}
