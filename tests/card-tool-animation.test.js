const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const study = fs.readFileSync(path.join(root, "js/study.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css/study.css"), "utf8");

test("кнопка «Информация о слове» использует иконку «i», а не книгу", () => {
  assert.match(study, /id="wordInfoBtn"[\s\S]{0,200}?<svg class="tool-info-icon"/);
  assert.doesNotMatch(study, /M2 3h6a4 4 0 0 1 4 4v14/);
});

test("волны динамика размечены для анимации", () => {
  assert.match(study, /class="tool-wave tool-wave-1"/);
  assert.match(study, /class="tool-wave tool-wave-2"/);
});

test("анимация постоянная, только для активных кнопок, с префиксами для старого Safari", () => {
  assert.match(css, /\.speaker-btn:not\(:disabled\) \.tool-wave \{[^}]*-webkit-animation: card-tool-wave[^}]*infinite/);
  assert.match(css, /\.info-link:not\(:disabled\) svg\.tool-info-icon \{[^}]*animation: card-tool-nudge[^}]*infinite/);
  assert.match(css, /@-webkit-keyframes card-tool-wave/);
  assert.match(css, /@-webkit-keyframes card-tool-nudge/);
});

test("анимация не сдвигает иконки и не использует :has()", () => {
  const block = css.slice(css.indexOf("@-webkit-keyframes card-tool-wave"));
  assert.doesNotMatch(block.slice(0, 2500), /translate/);
  assert.doesNotMatch(block.slice(0, 2500), /:has\(/);
});

test("уважается «Уменьшение движения»", () => {
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^}]*\.card-stage \.card-stage-side-tools \.speaker-btn \.tool-wave,[^}]*animation: none/);
});

test("иконки произношения и информации увеличены до 19px", () => {
  const mobile = fs.readFileSync(path.join(root, "css/mobile.css"), "utf8");
  for (const src of [css, mobile]) {
    assert.match(src, /\.card-stage-side-tools \.speaker-btn svg \{\s*width: 19px;\s*height: 19px;/);
  }
});

test("плюс «Добавить карточку» анимирован постоянно, пауза при открытом меню, отключение при reduce", () => {
  assert.match(css, /@-webkit-keyframes add-plus-nudge/);
  assert.match(css, /\.add-card-trigger\.bare-icon-btn:not\(:disabled\) svg \{[^}]*-webkit-animation: add-plus-nudge[^}]*infinite/);
  assert.match(css, /\.add-card-trigger\.bare-icon-btn\[aria-expanded="true"\] svg \{[^}]*animation-play-state: paused/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.add-card-trigger\.bare-icon-btn svg,/);
});
