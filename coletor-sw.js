/* Apenas /coletor é controlado; o painel do gestor mantém seu funcionamento. */
'use strict';
const CACHE = 'recicla-coletor-v1';
const LOCAIS = [
  '/coletor/index.html', '/coletor/styles.css', '/coletor/config.js',
  '/coletor/core.js', '/coletor/app.js', '/coletor/manifest.webmanifest', '/coletor/icon.svg',
  '/coletor/icon-192.png', '/coletor/icon-512.png'
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js',
  'https://cdn.jsdelivr.net/npm/dexie@4.0.11/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'
];
const ASSETS = [...LOCAIS, ...CDN];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // CORS garante respostas verificáveis. Se faltar uma dependência, o worker
    // não é instalado e a interface não anuncia que já está pronta offline.
    await cache.addAll(LOCAIS.map(url => new Request(url, { cache: 'reload' })));
    await Promise.all(CDN.map(async url => {
      const response = await fetch(url, { mode: 'cors', cache: 'reload' });
      if (!response.ok) throw new Error('Dependência indisponível: ' + url);
      await cache.put(url, response);
    }));
    // Não força atualização enquanto um coletor estiver preenchendo a entrega.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('recicla-coletor-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const local = url.origin === self.location.origin;
  const page = local && ['/coletor', '/coletor/', '/coletor/index.html'].includes(url.pathname);
  const asset = local ? LOCAIS.includes(url.pathname) : CDN.includes(url.href);
  if (!page && !asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(page ? '/coletor/index.html' : request);
    return hit || fetch(request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const present = await Promise.all(ASSETS.map(url => cache.match(url)));
    event.ports[0]?.postMessage({ ready: present.every(Boolean) });
  })());
});
