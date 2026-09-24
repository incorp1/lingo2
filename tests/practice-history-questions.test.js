const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "ai-practice.js"), "utf8");
const body = name => { const i = src.indexOf(`function ${name}(`); return src.slice(i, src.indexOf("\n}\n", i)); };

test("история сохраняет вопросы вместе с текстом", () => {
  assert.match(body("addPracticeHistory"), /questions: payload\.questions/);
});

test("открытие из истории показывает вопросы и проверку, как после генерации", () => {
  const open = body("openPracticeFromHistory");
  assert.match(open, /questions: Array\.isArray\(h\.questions\)/);
  assert.match(open, /renderPracticeRun\(\)/);
  assert.match(open, /\$\("#practiceCheckBtn"\)\.hidden = !hasQuestions/);
});
