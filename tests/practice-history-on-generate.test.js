const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "ai-practice.js"), "utf8");
const body = name => { const i = src.indexOf(`function ${name}(`); return src.slice(i, src.indexOf("\n}\n", i)); };

test("сгенерированный текст сразу попадает в историю практики", () => {
  const gen = body("practiceGenerate");
  assert.match(gen, /addPracticeHistory\(/);
  assert.ok(gen.indexOf("addPracticeHistory(") < gen.indexOf("renderPracticeRun()"));
});

test("проверка ответов не дублирует запись истории", () => {
  assert.doesNotMatch(body("practiceCheck") || "", /addPracticeHistory\(/);
  assert.equal((src.match(/addPracticeHistory\(\{/g) || []).length, 1);
});

test("addPracticeHistory игнорирует повторный id", () => {
  assert.match(body("addPracticeHistory"), /some\(item => String\(item\?\.id\) === entryId\)/);
});
