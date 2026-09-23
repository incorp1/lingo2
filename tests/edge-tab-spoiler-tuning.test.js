const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const edge = fs.readFileSync(path.join(__dirname, "..", "css", "edge-menu.css"), "utf8");
const study = fs.readFileSync(path.join(__dirname, "..", "css", "study.css"), "utf8");

test("язычок меню постоянно анимирует стрелку только в закрытом состоянии", () => {
  assert.match(edge, /@keyframes edge-tab-nudge/);
  assert.match(edge, /@-webkit-keyframes edge-tab-nudge/);
  assert.match(edge, /\.study-edge-tab:not\(\.is-open\):not\(\.is-dragging\)::before \{[^}]*animation: edge-tab-nudge/);
  assert.doesNotMatch(edge, /\.study-edge-tab \{[^}]*animation:/);
});

test("анимация язычка отключается при reduced motion", () => {
  const block = edge.slice(edge.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(block, /\.study-edge-tab:not\(\.is-open\):not\(\.is-dragging\)::before \{[^}]*animation: none/);
});

test("шум спойлера мерцает реже, плашка ниже", () => {
  assert.match(study, /animation: spoiler-static-a 2\.4s steps\(5, end\) infinite/);
  assert.match(study, /animation: spoiler-static-b 2s steps\(4, end\) infinite/);
  const rule = study.match(/\.card-stage \.pronunciation-spoiler \{[^}]*\}/)[0];
  assert.match(rule, /padding: 0 4px/);
  assert.match(rule, /line-height: 1\.15/);
});
