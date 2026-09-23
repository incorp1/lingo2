const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const ui = fs.readFileSync("js/ui.js", "utf8");
const css = fs.readFileSync("css/stats-settings.css", "utf8");

test("modal scroll lock guards touchmove non-passively and tracks all modals", () => {
  assert.match(ui, /function bindModalScrollLock\(/);
  assert.match(ui, /"touchmove"[\s\S]*?passive: false/);
  assert.match(ui, /attributeFilter: \["hidden"\]/);
  assert.match(ui, /\.modal:not\(\[hidden\]\)/);
});

test("modal scroll lock css contains overscroll and locks page", () => {
  assert.match(css, /\.modal, \.modal-panel, \.modal-body \{ overscroll-behavior: contain; \}/);
  assert.match(css, /html\.modal-scroll-locked body \{ overflow: hidden; \}/);
});
