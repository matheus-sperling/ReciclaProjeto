/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
  matchPrecache,
} from "workbox-precaching";
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};
const manifest = self.__WB_MANIFEST;
cleanupOutdatedCaches();
precacheAndRoute(manifest);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("recicla-coletor-")) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === "GET" &&
    event.request.mode === "navigate" &&
    url.origin === self.location.origin &&
    /^\/coletor(?:\/|$)/.test(url.pathname)
  ) {
    event.respondWith(
      (async () =>
        (await matchPrecache("/index.html")) || fetch(event.request))(),
    );
  }
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CHECK_OFFLINE")
    event.waitUntil(
      (async () => {
        const files = await Promise.all(
          manifest.map((item) => matchPrecache(item.url)),
        );
        event.ports[0]?.postMessage({
          ready: files.length > 0 && files.every(Boolean),
        });
      })(),
    );
});
