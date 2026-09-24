const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("выбор начинается по удержанию, а не по обычному тапу", () => {
  const selection = read("js/selection.js");

  assert.match(selection, /const SELECTION_HOLD_MS = 430/);
  assert.match(selection, /selectionHoldTimer = window\.setTimeout/);
  assert.match(selection, /document\.addEventListener\("pointerdown"/);
  assert.doesNotMatch(selection, /lookupWordAtPoint\(e\.clientX, e\.clientY\)/);
});

test("диапазон расширяется и редактируется за оба крайних слова", () => {
  const selection = read("js/selection.js");

  assert.match(selection, /pointTouchesBoundary\(lookupSelection\.start/);
  assert.match(selection, /pointTouchesBoundary\(lookupSelection\.end/);
  assert.match(selection, /gesture\.edge === "start"/);
  assert.match(selection, /gesture\.edge === "end"/);
  assert.match(selection, /setLookupSelection\(gesture\.boundary, boundary/);
});

test("нативные мобильные действия подавлены только в lookup-зонах", () => {
  const selection = read("js/selection.js");
  const css = read("css/features.css");

  assert.match(selection, /document\.addEventListener\("contextmenu"/);
  assert.match(selection, /document\.addEventListener\("dragstart"/);
  assert.match(selection, /document\.addEventListener\("selectstart"/);
  assert.match(selection, /if \(lookupZoneAt\(event\.target\)\) event\.preventDefault\(\)/);
  assert.match(css, /\.practice-q-label\s*\{[\s\S]*?-webkit-user-select: none;[\s\S]*?-webkit-touch-callout: none;/);
  assert.doesNotMatch(css, /body\s*\{[^}]*user-select:\s*none/);
});

test("подсветка имеет направленное переливание и reduced-motion режим", () => {
  const css = read("css/features.css");

  assert.match(css, /@keyframes lookup-selection-flow/);
  assert.match(css, /\.lookup-selection-mark::after/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.lookup-selection-mark\.is-start::before/);
  assert.match(css, /\.lookup-selection-mark\.is-end::before/);
});

test("активное выделение блокирует прокрутку и не пропадает при pointercancel", () => {
  const selection = read("js/selection.js");

  assert.match(selection, /setPointerCapture\?\.\(gesture\.pointerId\)/);
  assert.match(selection, /document\.addEventListener\("touchmove"[\s\S]*selectionGesture\?\.active[\s\S]*event\.preventDefault\(\)/);
  assert.match(selection, /document\.addEventListener\("wheel"[\s\S]*selectionGesture\?\.active[\s\S]*event\.preventDefault\(\)/);
  assert.match(selection, /if \(wasActive && lookupSelection\) \{[\s\S]*?commitLookupSelection\(true\);[\s\S]*?selectionHoldEndedAt = Date\.now\(\);/);
  assert.match(selection, /selectionHoldEndedAt = Date\.now\(\)/);
});

test("меню показывается сразу после удержания и обновляется при протягивании", () => {
  const selection = read("js/selection.js");

  assert.match(selection, /activateSelectionGesture[\s\S]*setLookupSelection\(boundary, boundary, gesture\.zone\);[\s\S]*commitLookupSelection\(true\)/);
  assert.match(selection, /setLookupSelection\(gesture\.boundary, boundary, gesture\.zone\);[\s\S]*commitLookupSelection\(true\)/);
});

test("выбранная фраза сохраняет перевод и добавление в карточку", () => {
  const selection = read("js/selection.js");

  assert.match(selection, /replaceSelectionData\(text, context\)/);
  assert.match(selection, /const word = selectionData\.word/);
  assert.match(selection, /\$\("#edFront"\)\.value = word/);
  assert.match(selection, /selectionData\.translation/);
});

test("окно выделения озвучивает актуальное слово или фразу через общий TTS", () => {
  const html = read("index.html");
  const selection = read("js/selection.js");

  assert.match(html, /id="selectionSpeakBtn"[\s\S]*?data-i18n-aria-label="selection\.pronounce"/);
  assert.match(selection, /function pronounceSelection\(\)/);
  assert.match(selection, /String\(selectionData\.word/);
  assert.match(selection, /speak\(word, \{ lang: learningSpeechLocale\(\) \}\)/);
  assert.match(selection, /speakBtn\.onclick = pronounceSelection/);
});

test("перевод выделения использует тот же акцентный цвет, что и поля редактора", () => {
  const features = read("css/features.css");
  const editor = read("css/card-editor.css");

  assert.match(features, /\.selection-pop-translation\s*\{[\s\S]*?color: var\(--accent\);[\s\S]*?-webkit-text-fill-color: var\(--accent\);/);
  assert.match(editor, /#editorModal \.editor-word-card textarea \{[\s\S]*?color: var\(--accent\);[\s\S]*?-webkit-text-fill-color: var\(--accent\);/);
});

test("фон меню повторяет форму всего блока и полностью растворяется по краям", () => {
  const css = read("css/features.css");

  assert.match(css, /\.selection-popover\s*\{[\s\S]*?background: transparent;[\s\S]*?border: 0;[\s\S]*?box-shadow: none;/);
  assert.match(css, /\.selection-popover::before\s*\{[\s\S]*?border-radius: inherit;[\s\S]*?background: color-mix\(in srgb, var\(--bg-elev\) 88%, var\(--ink\) 12%\);/);
  assert.match(css, /mask-image:[\s\S]*?linear-gradient\(to right, transparent 0, #000 6px, #000 calc\(100% - 6px\), transparent 100%\),[\s\S]*?linear-gradient\(to bottom, transparent 0, #000 5px, #000 calc\(100% - 5px\), transparent 100%\)/);
  assert.match(css, /mask-composite: intersect;/);
  assert.doesNotMatch(css, /\.selection-popover::before\s*\{[\s\S]*?radial-gradient/);
  assert.doesNotMatch(css, /\.selection-popover::before\s*\{[\s\S]*?drop-shadow/);
});

test("растворение начинается у самой кромки и не задевает текст меню", () => {
  const css = read("css/features.css");

  const popover = css.match(/\.selection-popover\s*\{[\s\S]*?\}/)[0];
  const padding = popover.match(/padding:\s*(\d+)px\s+(\d+)px/);
  assert.ok(padding, "меню должно задавать вертикальный и горизонтальный отступ");
  assert.ok(Number(padding[1]) >= 5 + 4, "вертикальный отступ должен перекрывать зону растворения");
  assert.ok(Number(padding[2]) >= 6 + 4, "горизонтальный отступ должен перекрывать зону растворения");
});

test("выделенное слово остаётся читаемым: подсветка только полупрозрачная", () => {
  const css = read("css/features.css");

  const mark = css.match(/\.lookup-selection-mark\s*\{[\s\S]*?\}/)[0];
  assert.doesNotMatch(mark, /mix-blend-mode/);
  assert.doesNotMatch(mark, /color-mix/, "базовое правило — без color-mix (Safari 15)");
  assert.match(css, /\.lookup-selection-mark \{[^}]*background: color-mix\(in srgb, var\(--accent\) \d+%, transparent\)/);
  assert.doesNotMatch(css, /\.lookup-selection-mark[^{]*\{[^}]*mix-blend-mode/);
  assert.doesNotMatch(css, /var\(--accent\) \d+%, var\(--panel\)\)/);
});

test("в тёмной теме меню не светлее фона, а на один мягкий шаг от него", () => {
  const css = read("css/features.css");

  assert.match(css, /html\[data-theme="dark"\] \.selection-popover::before,\s*html\.dark \.selection-popover::before \{\s*background: color-mix\(in srgb, var\(--panel\) 88%, var\(--bg\) 12%\);/);
  assert.match(css, /html\[data-theme="dark"\] \.lookup-selection-mark,[\s\S]*?background: color-mix\(in srgb, var\(--accent\) 26%, transparent\)/);
});