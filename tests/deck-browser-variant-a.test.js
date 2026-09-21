const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("вариант A подключён к рабочему экрану колоды", () => {
  const html = read("index.html");
  assert.match(html, /id="deckBrowseSubtitle"/);
  assert.match(html, /id="deckBrowseAddBtn"/);
  assert.match(html, /css\/deck-browser-vA\.css\?v=3\.20\.4/);
});

test("тап по строке открывает редактор, не перехватывая вложенные действия", () => {
  const source = read("js/decks.js");
  assert.match(source, /row\.onclick = event => \{/);
  assert.match(source, /event\.target\.closest\("button, input, select, a"\)/);
  assert.match(source, /openCardEditor\(card\.id\)/);
  assert.match(source, /row\.tabIndex = 0/);
});

test("мобильный список занимает остаток экрана без повторного нижнего отступа", () => {
  const css = read("css/deck-browser-vA.css");
  assert.match(css, /#deckBrowse \{[\s\S]*display: flex;[\s\S]*overflow: hidden;/);
  assert.match(css, /#deckBrowse \.card-table \{[\s\S]*flex: 1 1 auto;/);
  const tableBodyRule = css.match(/#deckBrowse #tableBody \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(tableBodyRule, /height: auto;/);
  assert.match(tableBodyRule, /flex: 1 1 auto;/);
  assert.match(tableBodyRule, /padding: 0 10px;/);
  assert.doesNotMatch(tableBodyRule, /safe-area-inset-bottom/);
  assert.match(css, /#view-decks\.view \{\s*padding: 0;/);
  assert.doesNotMatch(css, /#view-decks\.view \{[\s\S]*?54px \+ env\(safe-area-inset-bottom\)/);
});

test("фильтры оформлены компактным выпадающим меню", () => {
  const css = read("css/deck-browser-vA.css");
  assert.match(css, /#deckBrowse \.browse-advanced-filters \{[\s\S]*position: absolute;[\s\S]*border-radius: 14px;/);
  assert.match(css, /#deckBrowse \.browse-advanced-filters\[hidden\] \{ display: none; \}/);
});

test("новый стиль входит в PWA app shell", () => {
  const sw = read("sw.js");
  assert.match(sw, /lingo-cards-v3\.20\.4/);
  assert.match(sw, /deck-browser-vA\.css\?v=3\.20\.4/);
});