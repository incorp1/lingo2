const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("редактор карточки реализует структуру варианта C", () => {
  const html = read("index.html");

  assert.match(html, /class="modal-panel editor-panel"/);
  assert.match(html, /id="editorDeckName"/);
  assert.match(html, /class="editor-word-card" id="edFrontRow"/);
  assert.match(html, /class="editor-word-card editor-translation" id="edBackRow"/);
  assert.match(html, /class="editor-details"/);
  assert.match(html, /class="editor-selects"/);
  assert.doesNotMatch(html, /id="deleteCardBtn"/);
  assert.match(html, /<label for="edFront" data-i18n="modal\.front">Front<\/label>[\s\S]*?<textarea id="edFront"[\s\S]*?<button class="btn primary ai-gen-btn" id="aiGenBtn"/);
  assert.match(html, /<label for="edBack" data-i18n="modal\.back">Back<\/label>/);
  assert.match(html, /<textarea id="edExample"/);
  assert.match(html, /<textarea id="edHint"/);
  assert.doesNotMatch(html, /<input id="edHint"/);

  const ru = read("i18n/ru.js");
  assert.match(ru, /"modal\.front": "Слово \(лицевая\)"/);
  assert.match(ru, /"modal\.back": "Перевод \(обратная\)"/);
  assert.match(ru, /"ai\.generate": "Заполнить AI"/);

  for (const id of [
    "edFront",
    "edBack",
    "edCloze",
    "edExample",
    "edHint",
    "edType",
    "edDeck",
    "saveCardBtn",
    "saveAddAnotherBtn",
    "aiGenBtn",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("редактор сохраняет функциональные привязки без delete-контракта", () => {
  const cards = read("js/cards.js");
  const shell = read("js/app-shell.js");

  assert.match(cards, /function updateEditorDeckName\(\)/);
  assert.match(cards, /updateEditorDeckName\(\);\s+toggleClozeFields\(\);/);
  assert.doesNotMatch(cards, /deleteCardBtn/);
  assert.match(shell, /saveCardBtn"\)\.onclick = \(\) => saveCardFromEditor\(false\)/);
  assert.match(shell, /saveAddAnotherBtn"\)\.onclick = \(\) => saveCardFromEditor\(true\)/);
  assert.match(shell, /edDeck"\)\.addEventListener\("change", updateEditorDeckName\)/);
});

test("стили редактора изолированы и комфортны на мобильном", () => {
  const css = read("css/card-editor.css");

  assert.match(css, /#editorModal \.editor-word-card/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /#editorModal \.editor-details input,[\s\S]*font-size: 16px/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /color: var\(--accent\)/);
  assert.match(css, /text-decoration-color: color-mix\(in srgb, var\(--accent\) 60%, transparent\)/);
  assert.match(css, /overflow: hidden/);
  assert.match(css, /resize: none/);
  assert.match(css, /#editorModal \.ai-gen-btn \{[\s\S]*?justify-self: stretch;[\s\S]*?width: 100%;[\s\S]*?text-align: center;/);
});

test("поля редактора автоматически растут по содержимому", () => {
  const cards = read("js/cards.js");
  const aiPractice = read("js/ai-practice.js");

  assert.match(cards, /const EDITOR_TEXTAREA_IDS = \["edFront", "edBack", "edExample", "edHint"\]/);
  assert.match(cards, /function resizeEditorTextarea\(textarea\)/);
  assert.match(cards, /textarea\.style\.height = "auto"/);
  assert.match(cards, /textarea\.style\.height = `\$\{textarea\.scrollHeight\}px`/);
  assert.match(cards, /textarea\.addEventListener\("input", \(\) => resizeEditorTextarea\(textarea\)\)/);
  assert.match(cards, /requestAnimationFrame\(syncEditorTextareaHeights\)/);
  assert.match(aiPractice, /resizeEditorTextarea\(el\)/);
});

test("текущий релиз полностью включён в PWA-оболочку", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  const packageJson = JSON.parse(read("package.json"));

  // Версия релиза берётся из package.json, а не хардкодится: иначе каждый
  // выпуск ломал тесты, хотя оболочка была согласована.
  const version = packageJson.version;
  assert.match(version, /^\d+(?:\.\d+)*$/);
  const v = version.replace(/\./g, "\\.");

  assert.match(html, new RegExp(`css/card-editor\\.css\\?v=${v}`));
  assert.match(html, new RegExp(`css/motion\\.css\\?v=${v}`));
  assert.match(html, new RegExp(`js/motion\\.js\\?v=${v}`));
  assert.match(sw, new RegExp(`lingo-cards-v${v}`));
  assert.match(sw, new RegExp(`\\./css/card-editor\\.css\\?v=${v}`));
  assert.match(sw, new RegExp(`\\./css/motion\\.css\\?v=${v}`));
  assert.match(sw, new RegExp(`\\./js/motion\\.js\\?v=${v}`));
});