const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("текст вопросов входит во все зоны перевода по удержанию", () => {
  const selection = read("js/selection.js");
  const lookupSelector = ".card-front, .card-back, .card-example, .practice-story-body, .practice-q-label, .word-info-content";

  assert.match(selection, new RegExp(`const LOOKUP_SELECTOR = "${lookupSelector.replaceAll(".", "\\.")}"`));
  assert.match(selection, /selectionIsInsideLookupZone/);
  assert.match(selection, /beginSelectionGesture\(\{ x: event\.clientX, y: event\.clientY \}, zone, event\.pointerId, zone\)/);
  assert.doesNotMatch(selection, /lookupWordAtPoint/);
});

test("ответы в практике используют оформление полей редактора карточки", () => {
  const practiceCss = read("css/features.css");
  const editorCss = read("css/card-editor.css");

  for (const css of [practiceCss, editorCss]) {
    assert.match(css, /color: var\(--accent\)/);
    assert.match(css, /-webkit-text-fill-color: var\(--accent\)/);
    assert.match(css, /text-decoration-color: color-mix\(in srgb, var\(--accent\) 60%, transparent\)/);
  }

  assert.match(practiceCss, /\.practice-q:focus-within/);
  assert.match(practiceCss, /\.practice-answer \{[\s\S]*?background: transparent;[\s\S]*?font-size: 17px;/);
  assert.match(editorCss, /#editorModal \.editor-word-card textarea \{[\s\S]*?caret-color: var\(--accent\)/);
});