const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("долгий тап находит слово геометрией, а не только каретой WebKit", () => {
  const selection = read("js/selection.js");

  // iOS Safari отказывается отдавать каретку внутри текста с user-select: none,
  // поэтому основным путём должен быть замер прямоугольников слов.
  assert.match(selection, /function buildWordGeometry\(zone\)/);
  assert.match(selection, /createTreeWalker\(zone, NodeFilter\.SHOW_TEXT/);
  assert.match(selection, /function wordBoundaryByGeometry\(x, y, zone\)/);
  assert.match(selection, /return wordBoundaryByGeometry\(x, y, zone\) \|\| wordBoundaryByCaret\(x, y, zone\)/);
});

test("индекс слов кэшируется и сбрасывается при смене текста, скролле и ресайзе", () => {
  const selection = read("js/selection.js");

  assert.match(selection, /function zoneGeometrySignature\(zone\)/);
  assert.match(selection, /if \(wordGeometry\?\.zone === zone && wordGeometry\.signature === signature\) return wordGeometry/);
  assert.match(selection, /document\.addEventListener\("scroll"[\s\S]*?invalidateWordGeometry\(\)/);
  assert.match(selection, /window\.addEventListener\("resize"[\s\S]*?invalidateWordGeometry\(\)/);
});

test("на тач-устройствах жест ведут touch-события, а pointer-ветка не дублирует их", () => {
  const selection = read("js/selection.js");

  assert.match(selection, /document\.addEventListener\("touchstart"[\s\S]*?beginSelectionGesture\(point, zone, SELECTION_TOUCH_ID, zone, true\)/);
  assert.match(selection, /document\.addEventListener\("touchend"[\s\S]*?finishSelectionGesture\(\)/);
  assert.match(selection, /document\.addEventListener\("touchcancel"/);
  assert.match(selection, /if \(event\.pointerType === "touch"\) return;/);
  assert.match(selection, /if \(!selectionGesture \|\| selectionGesture\.viaTouch\) return;/);
});

test("тач-жест не захватывает pointer и корректно отменяется мультитачем", () => {
  const selection = read("js/selection.js");

  assert.match(selection, /if \(!gesture\.viaTouch\) \{\s*\n\s*try \{ gesture\.captureTarget\?\.setPointerCapture\?\.\(gesture\.pointerId\)/);
  assert.match(selection, /if \(event\.touches\.length > 1\) \{\s*\n\s*cancelSelectionGesture\(\);/);
  assert.match(selection, /if \(event\.cancelable\) event\.preventDefault\(\)/);
});

test("подсветка и меню видимы в браузерах без color-mix (Safari 15 / iPhone 7)", () => {
  const css = read("css/features.css");

  assert.match(css, /@supports not \(background: color-mix\(in srgb, #000 50%, transparent\)\)/);
  const fallback = css.match(/@supports not \(background: color-mix[\s\S]*?\n\}\n/)[0];
  assert.match(fallback, /\.lookup-selection-mark \{\s*\n\s*background: rgba\(201, 100, 66, 0\.22\)/);
  assert.match(fallback, /html\.dark \.lookup-selection-mark \{\s*\n\s*background: rgba\(228, 129, 96, 0\.26\)/);
});

test("меню выделения имеет непрозрачный фон там, где нет color-mix", () => {
  const css = read("css/features.css");
  const fallback = css.match(/@supports not \(background: color-mix[\s\S]*?\n\}\n/)[0];

  // В светлой теме `var(--bg-elev)` почти совпадает с фоном страницы, поэтому
  // фолбэк должен использовать заранее вычисленный цвет из color-mix.
  assert.match(fallback, /\.selection-popover::before \{[\s\S]*?background: #E0DFDB;/);
  assert.match(fallback, /html\.dark \.selection-popover::before \{\s*\n\s*background: #292825;/);
  assert.doesNotMatch(fallback, /background: var\(--bg-elev\)/);
  assert.doesNotMatch(fallback, /background: var\(--panel\)/);
});

test("старый WebKit не теряет поверхность меню из-за двухслойной маски", () => {
  const css = read("css/features.css");
  const fallback = css.match(/@supports not \(background: color-mix[\s\S]*?\n\}\n/)[0];

  // `mask-composite: intersect` в Safari 15 не поддерживается, а легаси
  // `-webkit-mask-composite` складывает слои иначе и может стереть фон целиком.
  assert.match(fallback, /-webkit-mask-image: none;/);
  assert.match(fallback, /\n\s*mask-image: none;/);
  assert.match(fallback, /border: 1px solid var\(--border-strong\);/);
  assert.match(fallback, /box-shadow: var\(--shadow-lg\);/);
});

test("перевод в меню не ждёт словарь и имеет короткий таймаут", () => {
  const selection = read("js/selection.js");

  assert.match(selection, /const SELECTION_TRANSLATE_TIMEOUT_MS = 12000/);
  assert.match(selection, /window\.LCAi\.quickTranslate\(word, lang, \{[\s\S]*?timeoutMs: SELECTION_TRANSLATE_TIMEOUT_MS,/);
  assert.doesNotMatch(selection, /LCAi\.quickLookup\(/);
});

test("истёкший запрос сообщает о таймауте, а не выглядит как отмена", () => {
  const ai = read("ai.js");

  // Safari 15 игнорирует аргумент `abort(reason)`, поэтому таймаут нужно
  // отслеживать отдельным флагом, иначе спиннер висит бесконечно.
  assert.match(ai, /let timedOut = false;/);
  assert.match(ai, /timedOut = true;\s*\n\s*controller\.abort\(timeoutError\(\)\);/);
  assert.match(ai, /if \(timedOut\) throw timeoutError\(\);/);
});

test("иконка произношения нарисована без круглой подложки и обводки", () => {
  const css = read("css/features.css");
  const rule = css.match(/\.selection-speak-btn \{[\s\S]*?\n\}/)[0];

  // iOS Safari подставляет собственную светлую поверхность кнопки, пока не
  // сброшен `appearance`, поэтому круг оставался виден именно на iPhone.
  assert.match(rule, /-webkit-appearance: none;/);
  assert.match(rule, /\n\s*appearance: none;/);
  assert.match(rule, /border: 0;/);
  assert.match(rule, /border-radius: 0;/);
  assert.match(rule, /background: none;/);
  assert.match(rule, /box-shadow: none;/);
});

test("иконка произношения окрашена в акцентный оранжевый приложения", () => {
  const css = read("css/features.css");
  const base = read("css/base.css");
  const rule = css.match(/\.selection-speak-btn \{[\s\S]*?\n\}/)[0];

  assert.match(rule, /color: var\(--accent\);/);
  assert.match(base, /--accent: #C96442;/);
  assert.match(base, /--accent: #E48160;/);
  // Стрелки svg наследуют цвет кнопки, отдельной заливки быть не должно.
  assert.match(read("index.html"), /id="selectionSpeakBtn"[\s\S]*?stroke="currentColor"/);
});

test("подложка не возвращается в состояниях hover, focus и active", () => {
  const css = read("css/features.css");

  // На тач-устройствах `:hover` залипает после тапа, поэтому любая поверхность
  // осталась бы на экране как закрашенный круг.
  const states = css.match(/\.selection-speak-btn:hover,\s*\n\.selection-speak-btn:focus,\s*\n\.selection-speak-btn:active \{[\s\S]*?\n\}/)[0];
  assert.match(states, /background: none;/);
  assert.match(states, /border: 0;/);
  assert.match(states, /box-shadow: none;/);
  assert.doesNotMatch(css, /\.selection-speak-btn:hover \{[^}]*background: var\(--accent-soft\)/);
});

test("кнопка озвучивания карточки в учёбе тоже без круга и обводки", () => {
  const css = read("css/study.css");
  const rule = css.match(/\.card-stage \.speaker-btn \{[\s\S]*?\n\}/)[0];

  // До правки здесь был `border-radius: 50%` с фоном `--bg-elev` и рамкой,
  // то есть та же круглая подложка, что и в меню выделения.
  assert.match(rule, /-webkit-appearance: none;/);
  assert.match(rule, /\n\s*appearance: none;/);
  assert.match(rule, /background: none;/);
  assert.match(rule, /border: 0;/);
  assert.match(rule, /border-radius: 0;/);
  assert.match(rule, /box-shadow: none;/);
  assert.doesNotMatch(rule, /border-radius: 50%/);
  assert.doesNotMatch(rule, /background: var\(--bg-elev\)/);
  assert.doesNotMatch(rule, /border: 1px solid/);
});

test("кнопка озвучивания карточки окрашена в акцентный оранжевый и центрирована", () => {
  const css = read("css/study.css");
  const rule = css.match(/\.card-stage \.speaker-btn \{[\s\S]*?\n\}/)[0];

  assert.match(rule, /color: var\(--accent\);/);
  assert.doesNotMatch(rule, /color: var\(--ink-muted\);/);
  // Общее правило в base.css задаёт `inline-grid`, который в старом WebKit
  // выравнивает глиф по базовой линии, поэтому здесь нужен явный flexbox.
  assert.match(rule, /display: flex;/);
  assert.match(rule, /align-items: center;/);
  assert.match(rule, /justify-content: center;/);
  assert.match(rule, /line-height: 0;/);
  assert.match(css, /\.card-stage \.speaker-btn svg \{ display: block;/);

  const states = css.match(/\.card-stage \.speaker-btn:hover,\s*\n\.card-stage \.speaker-btn:focus,\s*\n\.card-stage \.speaker-btn:active \{[\s\S]*?\n\}/)[0];
  assert.match(states, /background: none;/);
  assert.match(states, /border: 0;/);
  assert.doesNotMatch(css, /\.card-stage \.speaker-btn:hover \{[^}]*border-color: var\(--accent\)/);
});

test("иконка центрирована флексбоксом, а не сеткой с базовой линией", () => {
  const css = read("css/features.css");
  const rule = css.match(/\.selection-speak-btn \{[\s\S]*?\n\}/)[0];

  // `inline-grid` в старом WebKit выравнивал элемент по базовой линии текста,
  // из-за чего глиф уезжал ниже центра области нажатия.
  assert.doesNotMatch(rule, /display: inline-grid;/);
  assert.match(rule, /display: flex;/);
  assert.match(rule, /align-items: center;/);
  assert.match(rule, /justify-content: center;/);
  assert.match(rule, /line-height: 0;/);
  assert.match(css, /\.selection-speak-btn svg \{ display: block;/);
});