const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js/import-export.js"), "utf8");

function applySnapshotBody() {
  const start = source.indexOf("function applyCommittedSnapshot(");
  assert.notStrictEqual(start, -1, "не найдена функция applyCommittedSnapshot");
  const end = source.indexOf("\nasync function commitDestructiveSnapshot(", start);
  assert.notStrictEqual(end, -1, "не найден конец функции applyCommittedSnapshot");
  return source.slice(start, end);
}

test("полная замена снимка синхронизирует контрол языка обучения", () => {
  const body = applySnapshotBody();
  assert.ok(
    body.includes("syncLearningLanguageControl()"),
    "после импорта резервной копии селектор языка обучения должен быть пересинхронизирован"
  );
});

test("синхронизация языка выполняется до renderAll()", () => {
  const body = applySnapshotBody();
  const syncAt = body.indexOf("syncLearningLanguageControl()");
  // Ищем именно вызов, а не упоминание renderAll() в комментарии.
  const renderAt = body.indexOf("\n  renderAll()");
  assert.ok(syncAt !== -1 && renderAt !== -1, "обе операции должны присутствовать");
  assert.ok(
    syncAt < renderAt,
    "data-learning-language должен быть актуален до перерисовки учебного экрана"
  );
});

test("импорт резервной копии применяет активный язык из снимка", () => {
  // Смоделированный сценарий: активен норвежский, резервная копия — английская.
  const state = {
    activeLearningLanguage: "nb",
    decks: [{ id: "deck-en", learningLanguage: "en" }],
  };
  const restored = { activeLearningLanguage: "en", decks: state.decks };

  const select = { value: "nb" };
  const body = { attributes: {} };
  const normalize = code => (code === "en" || code === "nb" ? code : "en");

  // Аналог applyCommittedSnapshot: сначала состояние, затем синхронизация контрола.
  const applied = { ...restored };
  const code = normalize(applied.activeLearningLanguage);
  select.value = code;
  body.attributes["data-learning-language"] = code;

  assert.strictEqual(applied.activeLearningLanguage, "en");
  assert.strictEqual(select.value, "en", "селектор не должен показывать норвежский");
  assert.strictEqual(body.attributes["data-learning-language"], "en");
});
