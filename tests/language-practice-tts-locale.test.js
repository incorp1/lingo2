const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "ai-practice.js"), "utf8");

test("кнопка озвучивания практики передаёт локаль языка обучения", () => {
  assert.match(
    source,
    /#practiceTtsBtn"\)\.onclick =\s*\(\) =>\s*speak\([^;]*\{\s*lang:\s*learningSpeechLocale\(\)\s*\}\)/,
    "speak() в практике должен вызываться с явным lang"
  );
});

test("в практике не осталось вызовов speak без локали", () => {
  const calls = source.match(/speak\([^;]*?\)\s*;/gs) || [];
  assert.ok(calls.length > 0, "ожидался хотя бы один вызов speak");
  for (const call of calls) {
    assert.match(call, /lang:\s*learningSpeechLocale\(\)/, `вызов без локали: ${call.trim()}`);
  }
});
