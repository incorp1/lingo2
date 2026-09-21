const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("установленная PWA запускается из кеша без подключения к интернету", () => {
  const sw = read("sw.js");
  const manifest = JSON.parse(read("manifest.webmanifest"));
  const pkg = JSON.parse(read("package.json"));

  assert.equal(manifest.start_url, ".");
  assert.equal(manifest.scope, ".");
  assert.equal(manifest.display, "standalone");
  assert.match(sw, new RegExp(`const CACHE = "lingo-cards-v${pkg.version.replaceAll(".", "\\.")}"`));
  assert.match(sw, /await cache\.addAll\(APP_SHELL\)/);
  assert.match(sw, /if \(request\.mode === "navigate"\)/);
  // Навигация обслуживается network-first, чтобы обновление применялось с первого
  // запуска, но при недоступной сети документ обязан отдаваться из кеша.
  assert.match(sw, /const network = await refreshCachedRequest\(request, INDEX_URL\)/);
  assert.match(sw, /return \(await caches\.match\(INDEX_URL\)\) \|\| Response\.error\(\)/);
});

test("навигация не отдаёт устаревший документ, пока сеть доступна", () => {
  const sw = read("sw.js");
  const navigate = sw.slice(sw.indexOf('request.mode === "navigate"'), sw.indexOf("SHELL_URLS.has(url.href)"));
  const networkAt = navigate.indexOf("const network = await refreshCachedRequest");
  const cacheAt = navigate.indexOf("caches.match(INDEX_URL)");

  assert.ok(networkAt !== -1 && cacheAt !== -1, "нужны и сетевой запрос, и offline-фолбэк");
  assert.ok(networkAt < cacheAt, "сеть должна запрашиваться раньше кеша для index.html");
  assert.ok(
    !/event\.waitUntil\(refreshCachedRequest\(request, INDEX_URL\)\)/.test(navigate),
    "фоновое обновление index.html означало бы возврат к cache-first"
  );
});

test("в офлайн-кеш включены все локальные ресурсы страницы", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  const localAssets = [...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g)]
    .map(match => match[1])
    .filter(url => !url.startsWith("data:"));

  for (const asset of localAssets) {
    assert.ok(sw.includes(`"./${asset}"`), `APP_SHELL misses ${asset}`);
  }
  for (const required of ["./", "./index.html", "./icon-192.png", "./icon-512.png"]) {
    assert.ok(sw.includes(`"${required}"`), `APP_SHELL misses ${required}`);
  }
});