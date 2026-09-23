const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const css = readFileSync(path.join(__dirname, "../css/settings-polish.css"), "utf8");
const i = css.lastIndexOf("Единая сетка строк");
const block = css.slice(css.lastIndexOf("/*", i));

test("итоговый блок сетки настроек стоит последним и универсален для всех разделов", () => {
  assert.ok(i > 0);
  assert.ok(block.includes(".settings-route-panel"));
  assert.doesNotMatch(block, /#settings-(learning|generation|card-sound|appearance)/, "правила должны быть универсальными, без id разделов");
});
test("поля и селекты фиксированной высоты 40px и 16px шрифта (без зума iOS)", () => {
  assert.match(block, /height: 40px;\s*min-height: 40px;\s*max-height: 40px;/);
  assert.match(block, /font-size: 16px;/);
});
test("блок совместим с Safari 15", () => {
  const code = block.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /:has\(|color-mix\(|\bdvh\b|@container|@layer/);
});
test("строка темы в Оформлении остаётся в две колонки", () => {
  assert.match(block, /settings-row:not\(\.settings-control-stack\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(128px, 44%\)/);
  const js = readFileSync(path.join(__dirname, "../js/settings.js"), "utf8");
  assert.match(js, /themeRow\.classList\.remove\("settings-control-stack"\)/);
});

test("кольцо фокуса скрыто после касания и программного фокуса", () => {
  const base = readFileSync(path.join(__dirname, "../css/base.css"), "utf8");
  const init = readFileSync(path.join(__dirname, "../theme-init.js"), "utf8");
  assert.match(base, /html\.pointer-input :focus/);
  assert.match(init, /pointer-input/);
});
