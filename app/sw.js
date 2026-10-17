// Service worker: aplikace funguje i offline. Při změně souborů zvyšte VERSION.
const VERSION = 'jidelnicek-v18';
const ASSETS = [
  './', './index.html', './css/app.css', './js/app.js', './js/domain.js', './js/db.js', './js/pdf.js', './js/sync.js', './js/merge.js', './js/proposals.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// network-first: nové verze se načtou hned, offline jede z cache
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) return; // synchronizace jde vždy na server
  e.respondWith(
    fetch(e.request).then(res => {
      // necachovat přesměrování na přihlášení (Cloudflare Access) ani chyby
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
