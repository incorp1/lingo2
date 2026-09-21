const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("список колоды показывает цвет только на слове и срок до Учёбы", () => {
  const decks = read("js/decks.js");
  const css = read("css/deck-browser-vA.css");

  assert.match(decks, /const ROW_HEIGHT = 44;/);
  assert.match(decks, /function browseDueText\(card\)/);
  assert.match(decks, /row\.style\.setProperty\("--difficulty-bg", visual\.background\)/);
  assert.match(decks, /row\.querySelector\("\.browse-back"\)\.textContent = "";/);
  assert.match(decks, /statePill\.textContent = browseDueText\(card\);/);

  assert.match(css, /#deckBrowse #tableBody\s*\{[\s\S]*?padding: 0 10px;/);
  assert.doesNotMatch(css, /#deckBrowse #tableBody\s*\{[\s\S]*?safe-area-inset-bottom/);
  const rowRule = css.match(/#deckBrowse \.table-row \{[\s\S]*?\n  \}/)?.[0] || "";
  const wordRule = css.match(/#deckBrowse \.browse-front-word \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(rowRule, /height: 44px !important;/);
  assert.match(rowRule, /background: transparent;/);
  assert.doesNotMatch(rowRule, /var\(--difficulty-bg\)/);
  assert.match(wordRule, /background: var\(--difficulty-bg\);/);
  assert.match(wordRule, /border: 1px solid var\(--difficulty-border\);/);
  assert.match(css, /#deckBrowse \.browse-back \{ display: none !important; \}/);
});

test("долгое нажатие включает выбор, а следующие тапы переключают слова", () => {
  const decks = read("js/decks.js");
  const css = read("css/deck-browser-vA.css");

  assert.match(decks, /const BROWSE_LONG_PRESS_MS = 460;/);
  assert.match(decks, /function beginBrowseLongPress\(event, cardId\)/);
  assert.match(decks, /toggleBrowseCardSelection\(cardId, true\);/);
  assert.match(decks, /row\.onpointerdown = event => beginBrowseLongPress\(event, card\.id\);/);
  assert.match(decks, /if \(bulkSelected\.size\) \{[\s\S]*?toggleBrowseCardSelection\(card\.id\);/);
  assert.match(decks, /body\.addEventListener\("scroll", \(\) => \{[\s\S]*?cancelBrowseLongPress\(\);/);
  assert.match(decks, /browser\?\.classList\.toggle\("selection-mode", n > 0\)/);
  assert.match(css, /#deckBrowse \.table-row \.cb-cell \{[\s\S]*?display: none;/);
  assert.match(css, /#deckBrowse\.selection-mode \.table-row \.cb-cell \{ display: block; \}/);
});

test("выбранные слова и массовые действия оформлены компактно", () => {
  const css = read("css/deck-browser-vA.css");

  assert.match(css, /#deckBrowse \.table-row\.is-selected/);
  assert.match(css, /#deckBrowse \.bulk-actions\s*\{[\s\S]*?overflow-x: auto;/);
  assert.match(css, /#deckBrowse \.bulk-actions \.btn\s*\{[\s\S]*?min-height: 32px;/);
});