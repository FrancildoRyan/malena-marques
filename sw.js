/* Service Worker — guarda o "casco" do app para abrir mesmo sem internet.
   Os dados SEMPRE vêm do Supabase (nunca são cacheados aqui). */
const CACHE = 'clinica-v1';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/app.js',
  './js/vendor/supabase.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Só cuida do próprio site; Supabase e outros passam direto pela rede.
  if (url.origin !== location.origin) return;

  // Rede primeiro (sempre pega a versão mais nova); cache só como reserva offline.
  e.respondWith(
    fetch(req).then((res) => {
      const copia = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
