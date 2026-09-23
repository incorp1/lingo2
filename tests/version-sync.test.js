// Гарантирует, что версия из VERSION реально проставлена во все ассеты и в sw.js.
// Если VERSION правят вручную без tools/bump-version.mjs, PWA не обновляется.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

test("все версии ассетов совпадают с VERSION", () => {
  const v = read("VERSION").trim();
  for (const f of ["index.html", "sw.js"]) {
    const found = [...read(f).matchAll(/\?v=(\d+\.\d+\.\d+)/g)].map(m => m[1]);
    assert.ok(found.length > 0, f);
    assert.deepStrictEqual([...new Set(found)], [v], `${f}: ?v= не равен VERSION`);
  }
  assert.match(read("sw.js"), new RegExp(`const CACHE = "lingo-cards-v${v.replace(/\./g, "\\.")}"`));
  assert.match(read("index.html"), new RegExp(`app-build-version">v${v.replace(/\./g, "\\.")}<`));
});

test("поле поиска колоды сбрасывает глобальный стиль input селектором по id", () => {
  const css = read("css/features.css");
  assert.match(css, /#browseSearch,[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
});
