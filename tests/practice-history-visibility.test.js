const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "css", "features.css"), "utf8");
const rule = css.match(/\.practice-history-list \{[\s\S]*?\n\}/)[0];

test("список истории практики не схлопывается в 0px (без size containment)", () => {
  assert.doesNotMatch(rule, /contain:\s*(strict|size|content\s+size)/);
  assert.doesNotMatch(rule, /contain:[^;]*\bsize\b/);
  assert.doesNotMatch(rule, /\bheight:\s*0/);
});

test("атрибут hidden у списка истории реально скрывает его", () => {
  assert.match(css, /\.practice-history-list\[hidden\] \{ display: none; \}/);
});
