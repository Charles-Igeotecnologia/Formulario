/* ============================================================
   Coletor Territorial — Service Worker
   - Pré-caches App Shell no install
   - cache-first para assets locais e bibliotecas de mapa
   - network-first para o resto (com fallback ao cache)
   ============================================================ */
'use strict';

const VERSION = 'coletor-v2.0.0';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  // Leaflet CSS + JS (CDN, pré-cache p/ uso offline)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  // shp-write (ESM) — pré-cache para exportar Shapefile offline
  'https://unpkg.com/@crmackey/shp-write@0.4.5/lib/shpwriter.esm.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Adiciona um a um para que um item inválido não derrube todo o install
    await Promise.all(APP_SHELL.map(url =>
      cache.add(url).catch(err => console.warn('SW: falhou cachear', url, err))
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Sempre bypass para o próprio Service Worker
  if (url.pathname.endsWith('sw.js')) return;

  // Estratégia: cache-first para assets locais e bibliotecas conhecidas (Leaflet, shp-write)
  const isSameOrigin = url.origin === self.location.origin;
  const isKnownCDN = /unpkg\.com/.test(url.origin);

  if (isSameOrigin || isKnownCDN) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) {
        // revalida em background (stale-while-revalidate simplificado)
        fetch(req).then(res => {
          if (res && res.ok) {
            caches.open(VERSION).then(c => c.put(req, res.clone())).catch(()=>{});
          }
        }).catch(()=>{});
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(VERSION);
          cache.put(req, res.clone()).catch(()=>{});
        }
        return res;
      } catch (e) {
        // offline e sem cache: resposta mínima para não quebrar
        return new Response('Offline e sem cache para este recurso.', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Outras origens: network-first com fallback ao cache
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      return res;
    } catch (e) {
      const cached = await caches.match(req);
      return cached || new Response('Offline.', { status: 503, statusText: 'Offline' });
    }
  })());
});
