const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("practice generation uses editable topic, situation, style and temperature", () => {
  const state = read("js/state.js");
  const practice = read("js/ai-practice.js");
  const html = read("index.html");
  for (const key of ["practiceTopics", "practiceSituations", "practiceStyles"]) {
    assert.match(state, new RegExp(`${key}: "`));
  }
  assert.match(state, /practiceTemperature: 0\.9/);
  for (const id of ["setPracticeTopics", "setPracticeSituations", "setPracticeStyles", "setPracticeTemperature"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(practice, /\$\{practiceVarietyPrompt\(s\)\}/);
  assert.match(practice, /practiceTemperatureSetting\(s\)/);
  assert.doesNotMatch(practice, /prompt, 0\.7,/);
});
