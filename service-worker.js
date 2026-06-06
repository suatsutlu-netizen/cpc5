/**
 * service-worker.js — Controle Paie PWA
 * Stratégie : Cache-First avec mise à jour en arrière-plan (Stale-While-Revalidate)
 * L'application fonctionne 100% hors ligne après la première installation.
 */

const CACHE_NAME    = 'controle-paie-v1';
const CACHE_ASSETS  = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── Installation : mise en cache de toutes les ressources ────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activation : suppression des anciens caches ──────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch : Cache-First, fallback réseau, fallback app.html ──────
self.addEventListener('fetch', event => {
  // Ignorer les requêtes non-GET et les requêtes externes
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        // Retourner immédiatement depuis le cache si disponible
        if (cached) {
          // Mettre à jour en arrière-plan (stale-while-revalidate)
          fetch(event.request)
            .then(response => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(event.request, response));
              }
            })
            .catch(() => {});
          return cached;
        }

        // Pas en cache : tenter le réseau
        return fetch(event.request)
          .then(response => {
            if (!response || response.status !== 200) return response;
            // Mettre en cache la nouvelle ressource
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, clone));
            return response;
          })
          .catch(() => {
            // Hors ligne et pas en cache : retourner app.html (SPA fallback)
            return caches.match('./app.html');
          });
      })
  );
});
