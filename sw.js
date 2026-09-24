/* Lingo Cards — Service Worker */
const CACHE = "lingo-cards-v3.20.74";
const APP_SHELL = [
  "./",
  "./index.html",
  "./theme-init.js?v=3.20.74",
  "./css/base.css?v=3.20.74",
  "./css/study.css?v=3.20.74",
  "./css/decks.css?v=3.20.74",
  "./css/stats-settings.css?v=3.20.74",
  "./css/features.css?v=3.20.74",
  "./css/polish.css?v=3.20.74",
  "./css/mobile.css?v=3.20.74",
  "./css/edge-menu.css?v=3.20.74",
  "./css/settings-responsive.css?v=3.20.74",
  "./css/settings-polish.css?v=3.20.74",
  "./css/deck-browser-vA.css?v=3.20.74",
  "./css/card-editor.css?v=3.20.74",
  "./css/motion.css?v=3.20.74",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./select-arrow.png",
  "./fsrs.js?v=3.20.74",
  "./languages.js?v=3.20.74",
  "./storage.js?v=3.20.74",
  "./seed.js?v=3.20.74",
  "./ai.js?v=3.20.74",
  "./backup.js?v=3.20.74",
  "./i18n/uk.js?v=3.20.74",
  "./i18n/ru.js?v=3.20.74",
  "./i18n/en.js?v=3.20.74",
  "./i18n/runtime.js?v=3.20.74",
  "./js/state.js?v=3.20.74",
  "./js/scheduler.js?v=3.20.74",
  "./js/settings.js?v=3.20.74",
  "./js/cards.js?v=3.20.74",
  "./js/study.js?v=3.20.74",
  "./js/stats.js?v=3.20.74",
  "./js/ui.js?v=3.20.74",
  "./js/decks.js?v=3.20.74",
  "./js/import-export.js?v=3.20.74",
  "./js/ai-practice.js?v=3.20.74",
  "./js/selection.js?v=3.20.74",
  "./js/edge-menu.js?v=3.20.74",
  "./js/motion.js?v=3.20.74",
  "./js/learning-language.js?v=3.20.74",
  "./js/app-shell.js?v=3.20.74",
  "./tooltips.js?v=3.20.74"
];
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));
const INDEX_URL = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    // Намеренно без skipWaiting(): новый worker обязан остаться в состоянии
    // `waiting`, иначе `registration.waiting` всегда null и кнопка
    // «Перезагрузить» не может ничего применить. Активацию инициирует страница
    // сообщением SKIP_WAITING — автоматически либо по клику.
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
    // Network-first для навигации: `index.html` — единственный неверсионированный
    // документ, из которого берутся все `?v=` ссылки, включая регистрацию sw.js.
    // При cache-first запуск отдавал старый документ и лишь фоном обновлял кэш,
    // поэтому новая версия регистрировалась на следующий запуск, а применялась
    // только на третий — отсюда «нужно перезапустить несколько раз».
    event.respondWith((async () => {
      const network = await refreshCachedRequest(request, INDEX_URL);
      if (network) return network;
      // Offline-запуск по-прежнему работает из кэша.
      return (await caches.match(INDEX_URL)) || Response.error();
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