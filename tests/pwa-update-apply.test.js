const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("новый worker остаётся в waiting, иначе кнопка «Перезагрузить» ничего не применяет", () => {
  const sw = read("sw.js");
  const install = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("activate"'));

  assert.ok(
    !/self\.skipWaiting\(\)/.test(install),
    "skipWaiting() при установке обнуляет registration.waiting и ломает кнопку обновления"
  );
  assert.match(sw, /if \(event\.data\?\.type === "SKIP_WAITING"\) event\.waitUntil\(self\.skipWaiting\(\)\)/);
});

test("кнопка обновления подключена и применяет ожидающий worker", () => {
  const html = read("index.html");
  const stats = read("js/stats.js");

  assert.match(html, /id="applyUpdateBtn"/);
  assert.match(html, /id="updateNotice"/);
  assert.match(stats, /\$\("#applyUpdateBtn"\)\?\.addEventListener\("click"/);
  assert.match(stats, /if \(!registration\?\.waiting \|\| swUpdateApplying\) return false/);
});

test("обновление применяется автоматически не только в установленной PWA", () => {
  const stats = read("js/stats.js");
  const auto = stats.slice(
    stats.indexOf("function maybeApplyStandaloneUpdate"),
    stats.indexOf("function showUpdateAvailable")
  );

  assert.ok(auto.length > 0, "нужна функция автоприменения обновления");
  assert.ok(
    !/if \(!isStandalonePwa\(\)/.test(auto),
    "режим браузера не должен блокировать автоматическое применение обновления"
  );
  assert.match(auto, /applyServiceWorkerUpdate\(\{ automatic: true \}\)/);
});
