/* ============================================================
   Coletor Territorial — Service Worker
   - Pré-caches App Shell no install
   - cache-first p/ assets locais e bibliotecas de mapa
   - network-first p/ o resto (com fallback ao cache)
   - Auto-update: skipWaiting + clients.claim + mudança de VERSION
     dispara ativação que limpa caches antigos.
   ============================================================ */
'use strict';

// ⬆️ Incrementar este número a cada release para forçar atualização
const VERSION = 'coletor-v2.1.0';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './favicon.svg',
  // Leaflet CSS + JS (CDN, pré-cache p/ uso offline)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  // shp-write (ESM) — pré-cache para exportar Shapefile offline
  'https://unpkg.com/@crmackey/shp-write@0.4.5/lib/shpwriter.esm.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Adiciona um a um: um item inválido não derruba todo o install
    await Promise.all(APP_SHELL.map(url =>
      cache.add(url).catch(err => console.warn('SW: falhou cachear', url, err))
    ));
    // skipWaiting faz o novo SW assumir imediatamente, sem aguardar
    // o fechamento de todas as abas (essencial para updates automáticos).
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Limpa caches de versões anteriores
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    // clients.claim faz o novo SW controlar a aba atual imediatamente
    await self.clients.claim();
    // Avisa todas as abas que houve uma atualização
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', version: VERSION }));
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Sempre bypass para o próprio Service Worker
  if (url.pathname.endsWith('sw.js')) return;

  // Estratégia: cache-first para assets locais e bibliotecas conhecidas
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

// Ouve mensagens do cliente — "SKIP_WAITING" força o novo SW a assumir
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
