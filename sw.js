// Service worker: salva l'app in cache per farla funzionare senza connessione.
// Quando modifichi i file, incrementa la versione per aggiornare la cache
// e metti lo stesso numero in APP_VERSION (app.js), che si vede nel menu.
const CACHE = 'rapportini-v32';
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'lock-init.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'vendor/jspdf.umd.min.js',
  'vendor/jspdf.plugin.autotable.min.js',
];

self.addEventListener('install', e => {
  // cache: 'reload' scarica sempre dal server, ignorando la cache HTTP del browser:
  // altrimenti una nuova versione potrebbe salvare file vecchi.
  e.waitUntil(caches.open(CACHE).then(c =>
    c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Solo richieste ai file dell'app: tutto il resto non passa da qui
  // (e la CSP della pagina lo blocca comunque).
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit || fetch(e.request))
  );
});
