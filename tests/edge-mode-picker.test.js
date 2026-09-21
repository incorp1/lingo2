const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("study edge menu exposes one expandable Mode item with mode and card-front choices", () => {
  const html = read("index.html");
  const menuStart = html.indexOf('id="studyEdgeMenu"');
  const menuEnd = html.indexOf('<nav class="mobile-tabs"', menuStart);
  const menu = html.slice(menuStart, menuEnd);

  assert.ok(menuStart >= 0, "study edge menu must exist");
  assert.match(menu, /id="edgeModeBtn"[\s\S]*?aria-controls="edgeModePanel"/);
  assert.match(menu, /id="edgeModePanel"[^>]*hidden/);
  assert.equal((menu.match(/name="edgeStudyMode"/g) || []).length, 2);
  assert.equal((menu.match(/name="edgeStudyFront"/g) || []).length, 2);
  assert.match(menu, /data-i18n="settings\.cardMode"/);
  assert.match(menu, /data-i18n="settings\.cardFrontLanguage"/);
});

test("edge Mode picker reuses persisted learning-setting commits", () => {
  const source = read("js/edge-menu.js");

  assert.match(source, /function renderStudyEdgeModePicker\(\)/);
  assert.match(source, /commitStudyEdgeSelection\(input\.name, commitStudyCardModes\)/);
  assert.match(source, /commitStudyEdgeSelection\(input\.name, commitStudyCardFronts\)/);
  assert.match(source, /if \(!selected\.length\)/);
  assert.match(source, /setStudyEdgeModeExpanded\(false\)/);
});

test("edge Mode picker has compact mobile expansion styles", () => {
  const css = read("css/edge-menu.css");

  assert.match(css, /\.study-edge-mode-panel \{[\s\S]*?grid-template-columns: 1fr 1fr/);
  assert.match(css, /\.study-edge-mode-panel\[hidden\] \{[\s\S]*?display: none/);
  assert.match(css, /\.study-edge-mode-trigger\[aria-expanded="true"\]/);
});