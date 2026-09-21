const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js/import-export.js"), "utf8");

function resetProgressBody() {
  const start = source.indexOf("async function resetProgress(");
  assert.notStrictEqual(start, -1, "не найдена функция resetProgress");
  const end = source.indexOf("\nasync function wipeAll(", start);
  assert.notStrictEqual(end, -1, "не найден конец функции resetProgress");
  return source.slice(start, end);
}

test("AUD-010: сброс прогресса не создаёт поле practiceHistory на верхнем уровне состояния", () => {
  const body = resetProgressBody();
  assert.doesNotMatch(
    body,
    /nextState\.practiceHistory/,
    "resetProgress не должен обращаться к nextState.practiceHistory"
  );
});

test("AUD-010: история практики нормализуется в settings.practiceHistory", () => {
  const body = resetProgressBody();
  assert.ok(
    body.includes("nextState.settings.practiceHistory"),
    "resetProgress должен работать с settings.practiceHistory"
  );
});

test("AUD-010: единственный источник истории практики — settings.practiceHistory", () => {
  const files = ["js/import-export.js", "js/ai-practice.js"];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(
      text,
      /state\.practiceHistory\b/,
      `${file}: обнаружен дублирующий источник истории практики`
    );
  }
});
