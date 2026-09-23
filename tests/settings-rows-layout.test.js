const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const css = readFileSync(path.join(__dirname, "../css/settings-polish.css"), "utf8");
const i = css.lastIndexOf("Единая сетка строк");
const block = css.slice(css.lastIndexOf("/*", i));

test("итоговый блок сетки настроек стоит последним и покрывает 4 раздела", () => {
  assert.ok(i > 0);
  for (const id of ["#settings-learning", "#settings-generation", "#settings-card-sound", "#settings-appearance"]) assert.ok(block.includes(id), id);
});
test("поля и селекты фиксированной высоты 40px и 16px шрифта (без зума iOS)", () => {
  assert.match(block, /height: 40px;\s*min-height: 40px;\s*max-height: 40px;/);
  assert.match(block, /font-size: 16px;/);
});
test("блок совместим с Safari 15", () => {
  const code = block.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /:has\(|color-mix\(|\bdvh\b|@container|@layer/);
});
