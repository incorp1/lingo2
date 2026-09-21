const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("нетегированный писатель истории практики удалён", () => {
  const source = read("js/ai-practice.js");
  assert.doesNotMatch(source, /function savePracticeToHistory\(/);
  assert.doesNotMatch(source, /savePracticeToHistory\(/);
});

test("addPracticeHistory остаётся единственным писателем истории", () => {
  const source = read("js/ai-practice.js");
  const writers = source.match(/state\.settings\.practiceHistory\.unshift\(/g) || [];
  assert.strictEqual(writers.length, 1, "история должна пополняться только из addPracticeHistory");

  const start = source.indexOf("function addPracticeHistory(");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.match(body, /learningLanguage: code,/);
  assert.match(body, /trimPracticeHistory\(code\)/);
});

test("обрезка истории практики выполняется только с языковым фильтром", () => {
  const source = read("js/ai-practice.js");
  assert.doesNotMatch(source, /state\.settings\.practiceHistory\.splice\(PRACTICE_HISTORY_MAX\)/);

  const PRACTICE_HISTORY_MAX = 2;
  const languageOf = entry => (entry.learningLanguage === "nb" ? "nb" : "en");
  const store = {
    practiceHistory: [
      { id: "nb-1", learningLanguage: "nb" },
      { id: "en-3", learningLanguage: "en" },
      { id: "en-2", learningLanguage: "en" },
      { id: "en-1", learningLanguage: "en" },
    ],
  };
  const trim = code => {
    let seen = 0;
    const drop = new Set();
    for (const entry of store.practiceHistory) {
      if (languageOf(entry) !== code) continue;
      seen += 1;
      if (seen > PRACTICE_HISTORY_MAX) drop.add(entry.id);
    }
    store.practiceHistory = store.practiceHistory.filter(entry => !drop.has(entry.id));
  };

  trim("en");
  assert.deepStrictEqual(
    store.practiceHistory.map(entry => entry.id),
    ["nb-1", "en-3", "en-2"],
    "переполнение английской истории не должно вытеснять норвежские записи"
  );
});
