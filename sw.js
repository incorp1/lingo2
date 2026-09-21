/* Lingo Cards — Service Worker */
const CACHE = "lingo-cards-v3.19.16";
const APP_SHELL = [
  "./",
  "./index.html",
  "./theme-init.js?v=3.19.16",
  "./css/base.css?v=3.19.16",
  "./css/study.css?v=3.19.16",
  "./css/decks.css?v=3.19.16",
  "./css/stats-settings.css?v=3.19.16",
  "./css/features.css?v=3.19.16",
  "./css/polish.css?v=3.19.16",
  "./css/mobile.css?v=3.19.16",
  "./css/edge-menu.css?v=3.19.16",
  "./css/settings-responsive.css?v=3.19.16",
  "./css/settings-polish.css?v=3.19.16",
  "./css/deck-browser-vA.css?v=3.19.16",
  "./css/card-editor.css?v=3.19.16",
  "./css/motion.css?v=3.19.16",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./select-arrow.png",
  "./fsrs.js?v=3.19.16",
  "./languages.js?v=3.19.16",
  "./storage.js?v=3.19.16",
  "./seed.js?v=3.19.16",
  "./ai.js?v=3.19.16",
  "./backup.js?v=3.19.16",
  "./i18n/uk.js?v=3.19.16",
  "./i18n/ru.js?v=3.19.16",
  "./i18n/en.js?v=3.19.16",
  "./i18n/runtime.js?v=3.19.16",
  "./js/state.js?v=3.19.16",
  "./js/scheduler.js?v=3.19.16",
  "./js/settings.js?v=3.19.16",
  "./js/cards.js?v=3.19.16",
  "./js/study.js?v=3.19.16",
  "./js/stats.js?v=3.19.16",
  "./js/ui.js?v=3.19.16",
  "./js/decks.js?v=3.19.16",
  "./js/import-export.js?v=3.19.16",
  "./js/ai-practice.js?v=3.19.16",
  "./js/selection.js?v=3.19.16",
  "./js/edge-menu.js?v=3.19.16",
  "./js/motion.js?v=3.19.16",
  "./js/app-shell.js?v=3.19.16",
  "./tooltips.js?v=3.19.16"
];
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));
const INDEX_URL = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const ownedCache = /^lingo-cards-v\d+(?:\.\d+)*$/;
    await Promise.all(keys
      .filter(key => ownedCache.test(key) && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

async function refreshCachedRequest(request, cacheKey = request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE);
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    return null;
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cached = await caches.match(INDEX_URL);
      if (cached) {
        event.waitUntil(refreshCachedRequest(request, INDEX_URL));
        return cached;
      }
      const network = await refreshCachedRequest(request, INDEX_URL);
      return network || Response.error();
    })());
    return;
  }

  if (!SHELL_URLS.has(url.href)) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      event.waitUntil(refreshCachedRequest(request));
      return cached;
    }
    return (await refreshCachedRequest(request)) || Response.error();
  })());
});